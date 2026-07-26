// ============================================================
// FILE: src/services/respan-integration.service.ts
// Respan Telemetry Integration Service
// ============================================================

import { respanLogger, RespanLogEntry } from '../utils/logging/respan-logger';
import { performanceTracker } from '../utils/logging/performance-tracker';
import { tokenCounter } from '../utils/logging/token-counter';

export interface RespanIntegrationConfig {
  endpoint: string;
  apiKey: string;
  environment: string;
  service: string;
  enabled: boolean;
}

export interface RespanTelemetryOptions {
  executionId?: string;
  pipelineId?: string;
  agentId?: string;
  metadata?: Record<string, any>;
}

export interface RespanSpanOptions {
  name: string;
  executionId?: string;
  parentSpanId?: string;
  metadata?: Record<string, any>;
}

export class RespanIntegrationService {
  private config: RespanIntegrationConfig;

  constructor(config?: Partial<RespanIntegrationConfig>) {
    this.config = {
      endpoint: process.env.RESPAN_ENDPOINT || 'https://respan.realestatecopilot.ai/api/v1/telemetry',
      apiKey: process.env.RESPAN_API_KEY || '',
      environment: process.env.NODE_ENV || 'development',
      service: process.env.APP_NAME || 'realestate-copilot',
      enabled: process.env.RESPAN_ENABLE_LIVE_DASHBOARD !== 'false',
      ...config,
    };
  }

  /**
   * Log an event to Respan
   */
  public async logEvent(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    options: RespanTelemetryOptions = {}
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const entry: Omit<RespanLogEntry, 'timestamp' | 'service' | 'environment'> = {
      level,
      message,
      execution_id: options.executionId,
      pipeline_id: options.pipelineId,
      agent_id: options.agentId,
      metadata: options.metadata,
    };

    await respanLogger.log(entry);
  }

  /**
   * Log agent execution
   */
  public logAgentExecution(params: {
    agentId: string;
    executionId: string;
    pipelineId?: string;
    status: 'started' | 'completed' | 'failed';
    latencyMs?: number;
    tokenUsage?: number;
    promptVersion?: string;
    metadata?: Record<string, any>;
    error?: Error;
  }): void {
    respanLogger.logAgentExecution({
      agent_id: params.agentId,
      execution_id: params.executionId,
      pipeline_id: params.pipelineId,
      status: params.status,
      latency_ms: params.latencyMs,
      token_usage: params.tokenUsage,
      prompt_version: params.promptVersion,
      metadata: params.metadata,
      error: params.error,
    });
  }

  /**
   * Log pipeline execution
   */
  public logPipelineExecution(params: {
    pipelineId: string;
    executionId: string;
    status: 'started' | 'completed' | 'failed';
    totalLatencyMs?: number;
    totalTokens?: number;
    stages?: Array<{
      stageId: string;
      status: string;
      latencyMs: number;
      tokens: number;
    }>;
    error?: Error;
  }): void {
    respanLogger.logPipelineExecution({
      pipeline_id: params.pipelineId,
      execution_id: params.executionId,
      status: params.status,
      total_latency_ms: params.totalLatencyMs,
      total_tokens: params.totalTokens,
      stages: params.stages?.map((stage) => ({
        stage_id: stage.stageId,
        status: stage.status,
        latency_ms: stage.latencyMs,
        tokens: stage.tokens,
      })),
      error: params.error,
    });
  }

  /**
   * Log LLM call
   */
  public logLLMCall(params: {
    executionId: string;
    model: string;
    provider: 'minimax' | 'cerebras';
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    promptVersion?: string;
    costEstimate?: number;
    error?: Error;
  }): void {
    respanLogger.logLLMCall({
      execution_id: params.executionId,
      model: params.model,
      provider: params.provider,
      latency_ms: params.latencyMs,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.promptTokens + params.completionTokens,
      prompt_version: params.promptVersion,
      cost_estimate: params.costEstimate,
      error: params.error,
    });
  }

  /**
   * Start a performance span
   */
  public startSpan(options: RespanSpanOptions): string {
    return performanceTracker.start(options.name, {
      ...options.metadata,
      execution_id: options.executionId,
      parent_span_id: options.parentSpanId,
    });
  }

  /**
   * End a performance span
   */
  public endSpan(spanId: string, metadata?: Record<string, any>): void {
    performanceTracker.end(spanId, metadata);
  }

  /**
   * Track an async operation with performance monitoring
   */
  public async trackOperation<T>(
    name: string,
    fn: () => Promise<T>,
    options: Omit<RespanSpanOptions, 'name'> = {}
  ): Promise<T> {
    const spanId = this.startSpan({ ...options, name });
    
    try {
      const result = await fn();
      this.endSpan(spanId, { success: true });
      return result;
    } catch (error) {
      this.endSpan(spanId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Estimate tokens in text
   */
  public estimateTokens(text: string): number {
    return tokenCounter.estimateTokens(text);
  }

  /**
   * Get token usage for a prompt
   */
  public getPromptUsage(systemPrompt: string, userPrompt: string): {
    systemTokens: number;
    userTokens: number;
    totalTokens: number;
    estimatedCost: number;
  } {
    return tokenCounter.getPromptUsage(systemPrompt, userPrompt);
  }

  /**
   * Create a telemetry context
   */
  public createContext(options: RespanTelemetryOptions): {
    executionId: string;
    startTime: number;
    log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
    finish: (status: 'success' | 'failure', metadata?: Record<string, any>) => Promise<void>;
  } {
    const executionId = options.executionId || `exec-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    return {
      executionId,
      startTime,
      log: async (level, message) => {
        await this.logEvent(level, message, { ...options, executionId });
      },
      finish: async (status, metadata) => {
        const latency = Date.now() - startTime;
        await this.logEvent('info', `Execution ${status}: ${executionId}`, {
          ...options,
          executionId,
          metadata: {
            ...metadata,
            status,
            latency_ms: latency,
          },
        });
        
        // Also track performance
        performanceTracker.end(`${executionId}-start`, {
          status,
          latency_ms: latency,
          ...metadata,
        });
      },
    };
  }

  /**
   * Get configuration
   */
  public getConfig(): RespanIntegrationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<RespanIntegrationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if telemetry is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }
}

export const respanIntegration = new RespanIntegrationService();

export default {
  RespanIntegrationService,
  respanIntegration,
};