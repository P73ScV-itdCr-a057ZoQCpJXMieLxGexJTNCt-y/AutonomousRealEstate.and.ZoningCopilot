// ============================================================
// FILE: src/services/band-integration.service.ts
// Updated with full Agent API + WebSocket support
// ============================================================

import { BandClient, BandClientConfig, BandApprovalRequest, BandApprovalResponse } from '../utils/api';
import { logger } from '../utils/logger';

export interface BandIntegrationConfig {
  apiKey: string;
  agentId: string;
  baseUrl: string;
  defaultWorkspace: string;
  defaultChannel: string;
  timeoutMinutes: number;
  wsEndpoint: string;
}

export interface BandMessageOptions {
  channelId?: string;
  workspaceId?: string;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  metadata?: Record<string, any>;
  mentions?: string[]; // @mentions specific agents/users
}

export interface BandApprovalOptions {
  channelId?: string;
  timeoutMinutes?: number;
  requireAll?: boolean;
  metadata?: Record<string, any>;
}

export interface BandApprovalResult {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'escalated' | 'expired';
  selectedOption?: string;
  respondedBy?: string;
  respondedAt?: string;
  allResponses?: Array<{
    userId: string;
    option: string;
    timestamp: string;
  }>;
}

/**
 * Band Agent Event Types
 */
export type BandEventType = 
  | 'message_created'
  | 'participant_added'
  | 'participant_removed'
  | 'room_added'
  | 'room_removed'
  | 'contact_request_received'
  | 'contact_added';

export interface BandEvent {
  type: BandEventType;
  payload: any;
  room_id?: string;
  agent_id?: string;
  timestamp: string;
}

export class BandIntegrationService {
  private client: BandClient;
  private config: BandIntegrationConfig;
  private ws: WebSocket | null = null;
  private eventHandlers: Map<BandEventType, ((payload: any) => void)[]> = new Map();
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(config?: Partial<BandIntegrationConfig>) {
    this.config = {
      apiKey: process.env.BAND_API_KEY || '',
      agentId: process.env.BAND_AGENT_ID || '',
      baseUrl: process.env.BAND_API_URL || 'https://app.band.ai/api/v1',
      defaultWorkspace: process.env.BAND_DEFAULT_WORKSPACE || 'realestate-copilot',
      defaultChannel: 'zoning_approvals',
      timeoutMinutes: parseInt(process.env.BAND_APPROVAL_TIMEOUT_MINUTES || '1440'),
      wsEndpoint: process.env.BAND_WS_URL || 'wss://app.band.ai/api/v1/socket/websocket',
      ...config,
    };

    this.client = new BandClient({
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });
  }

  /**
   * Initialize WebSocket connection for real-time events
   */
  public async initializeWebSocket(): Promise<void> {
    if (this.ws && this.isConnected) {
      logger.info('[Band] WebSocket already connected');
      return;
    }

    const wsUrl = `${this.config.wsEndpoint}?token=${this.config.apiKey}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('[Band] WebSocket connected');

      // Subscribe to agent-specific channels
      this.subscribeToChannels();
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleWebSocketMessage(data.toString());
    });

    this.ws.on('error', (error) => {
      logger.error('[Band] WebSocket error:', error);
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      logger.warn('[Band] WebSocket disconnected');
      this.attemptReconnect();
    });
  }

  /**
   * Subscribe to agent channels
   */
  private subscribeToChannels(): void {
    if (!this.ws || !this.isConnected) return;

    // Subscribe to agent's room notifications
    this.sendWebSocketMessage('phx_join', 'agent_rooms', {
      agent_id: this.config.agentId
    });

    // Subscribe to contact requests
    this.sendWebSocketMessage('phx_join', 'agent_contacts', {
      agent_id: this.config.agentId
    });

    logger.info('[Band] Subscribed to agent channels');
  }

  /**
   * Subscribe to a specific chat room
   */
  public subscribeToRoom(roomId: string): void {
    if (!this.ws || !this.isConnected) {
      logger.warn('[Band] Cannot subscribe to room: WebSocket not connected');
      return;
    }

    this.sendWebSocketMessage('phx_join', `chat_room:${roomId}`, {
      room_id: roomId
    });

    logger.info(`[Band] Subscribed to room: ${roomId}`);
  }

  /**
   * Register event handler
   */
  public on(eventType: BandEventType, handler: (payload: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(message: string): void {
    try {
      const data = JSON.parse(message);
      const event = data.event;

      // Phoenix heartbeat
      if (event === 'phx_reply') {
        return;
      }

      // Handle incoming events
      switch (event) {
        case 'message_created':
          this.emitEvent('message_created', data.payload);
          break;
        case 'participant_added':
          this.emitEvent('participant_added', data.payload);
          break;
        case 'participant_removed':
          this.emitEvent('participant_removed', data.payload);
          break;
        case 'room_added':
          this.emitEvent('room_added', data.payload);
          break;
        case 'contact_request_received':
          this.emitEvent('contact_request_received', data.payload);
          break;
        default:
          logger.debug(`[Band] Unhandled event: ${event}`);
      }
    } catch (error) {
      logger.error('[Band] Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Emit event to registered handlers
   */
  private emitEvent(type: BandEventType, payload: any): void {
    const handlers = this.eventHandlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        logger.error(`[Band] Handler error for ${type}:`, error);
      }
    }
  }

  /**
   * Send WebSocket message
   */
  private sendWebSocketMessage(event: string, topic: string, payload: any): void {
    if (!this.ws || !this.isConnected) {
      logger.warn(`[Band] Cannot send message: WebSocket not connected`);
      return;
    }

    const message = JSON.stringify({
      event,
      topic,
      payload,
      ref: Date.now().toString()
    });

    this.ws.send(message);
  }

  /**
   * Attempt reconnection
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('[Band] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info(`[Band] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.initializeWebSocket();
    }, delay);
  }

  /**
   * Send a message to a Band channel with @mentions
   */
  public async sendMessage(
    content: string,
    options: BandMessageOptions = {}
  ): Promise<any> {
    const channelId = options.channelId || this.config.defaultChannel;

    logger.info(`[Band] Sending message to channel: ${channelId}`);

    const message = {
      channel_id: channelId,
      content,
      type: 'text' as const,
      mentions: options.mentions || [],
      metadata: {
        priority: options.priority || 'medium',
        tags: options.tags || [],
        ...options.metadata,
      },
    };

    return this.client.sendMessage(message);
  }

  /**
   * Send a structured property alert to Band
   */
  public async sendPropertyAlert(
    propertyId: string,
    propertyAddress: string,
    densityScore: number,
    message: string,
    dealScore?: number,
    level: 'info' | 'warning' | 'error' | 'success' = 'info',
    mentions?: string[]
  ): Promise<any> {
    const emoji = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '🚨',
      success: '✅',
    };

    const dealEmoji = dealScore && dealScore < 0.85 ? '🔥' : 
                      dealScore && dealScore < 0.95 ? '💰' : '';

    const content = `
${emoji[level]} ${dealEmoji} **Property Alert: ${propertyAddress}**

**Property ID:** ${propertyId}
**Density Score:** ${densityScore}/100
${dealScore ? `**Deal Score:** ${dealScore.toFixed(2)} ${dealScore < 0.85 ? '(Strong Buy!)' : dealScore < 0.95 ? '(Good Deal)' : ''}` : ''}

${message}

---
*Generated by Autonomous Real Estate Co-Pilot*
${dealScore && dealScore < 0.85 ? '🚨 **High Priority: Strong Buy Opportunity**' : ''}
    `;

    return this.sendMessage(content, {
      mentions,
      metadata: {
        property_id: propertyId,
        density_score: densityScore,
        deal_score: dealScore,
        alert_level: level,
      },
    });
  }

  /**
   * Create an approval request in Band
   */
  public async createApproval(
    title: string,
    description: string,
    options: Array<{ label: string; value: string; action: 'approve' | 'reject' | 'escalate' }>,
    approvalOptions: BandApprovalOptions = {}
  ): Promise<BandApprovalResult> {
    const channelId = approvalOptions.channelId || this.config.defaultChannel;
    const timeoutMinutes = approvalOptions.timeoutMinutes || this.config.timeoutMinutes;

    logger.info(`[Band] Creating approval request: ${title}`);

    const request: BandApprovalRequest = {
      channel_id: channelId,
      title,
      description,
      options: options.map(opt => ({
        label: opt.label,
        value: opt.value,
        action: opt.action,
      })),
      timeout_minutes: timeoutMinutes,
      metadata: approvalOptions.metadata || {},
    };

    const response = await this.client.createApprovalRequest(request);

    return {
      requestId: response.request_id,
      status: response.status,
      selectedOption: response.selected_option || undefined,
      respondedBy: response.responded_by || undefined,
      respondedAt: response.responded_at || undefined,
    };
  }

  /**
   * Get approval request status
   */
  public async getApprovalStatus(requestId: string): Promise<BandApprovalResult> {
    const response = await this.client.getApprovalStatus(requestId);

    return {
      requestId: response.request_id,
      status: response.status,
      selectedOption: response.selected_option || undefined,
      respondedBy: response.responded_by || undefined,
      respondedAt: response.responded_at || undefined,
    };
  }

  /**
   * Approve a request
   */
  public async approveRequest(requestId: string, comment?: string): Promise<BandApprovalResult> {
    logger.info(`[Band] Approving request: ${requestId}`);
    const response = await this.client.approveRequest(requestId, comment);

    return {
      requestId: response.request_id,
      status: response.status,
      selectedOption: response.selected_option || undefined,
      respondedBy: response.responded_by || undefined,
      respondedAt: response.responded_at || undefined,
    };
  }

  /**
   * Reject a request
   */
  public async rejectRequest(requestId: string, reason: string): Promise<BandApprovalResult> {
    logger.info(`[Band] Rejecting request: ${requestId}`);
    const response = await this.client.rejectRequest(requestId, reason);

    return {
      requestId: response.request_id,
      status: response.status,
      selectedOption: response.selected_option || undefined,
      respondedBy: response.responded_by || undefined,
      respondedAt: response.responded_at || undefined,
    };
  }

  /**
   * Broadcast to multiple channels
   */
  public async broadcast(
    channelIds: string[],
    content: string,
    metadata?: Record<string, any>
  ): Promise<any[]> {
    logger.info(`[Band] Broadcasting to ${channelIds.length} channels`);
    return this.client.broadcast(channelIds, content, metadata);
  }

  /**
   * Get agent's rooms
   */
  public async getAgentRooms(): Promise<any> {
    return this.client.get('/agent/chats');
  }

  /**
   * Get pending messages for this agent
   */
  public async getPendingMessages(): Promise<any> {
    return this.client.get(`/agent/chats/${this.config.agentId}/messages/next`);
  }

  /**
   * Mark message as being processed
   */
  public async markMessageProcessing(messageId: string): Promise<any> {
    return this.client.post(`/messages/${messageId}/processing`);
  }

  /**
   * Mark message as processed
   */
  public async markMessageProcessed(messageId: string): Promise<any> {
    return this.client.post(`/messages/${messageId}/processed`);
  }

  /**
   * Mark message as failed
   */
  public async markMessageFailed(messageId: string, reason: string): Promise<any> {
    return this.client.post(`/messages/${messageId}/failed`, { reason });
  }

  /**
   * Get configuration
   */
  public getConfig(): BandIntegrationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<BandIntegrationConfig>): void {
    this.config = { ...this.config, ...config };
    this.client.updateConfig({
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });
  }

  /**
   * Disconnect WebSocket
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      logger.info('[Band] WebSocket disconnected');
    }
  }
}

export const bandIntegration = new BandIntegrationService();

export default {
  BandIntegrationService,
  bandIntegration,
};