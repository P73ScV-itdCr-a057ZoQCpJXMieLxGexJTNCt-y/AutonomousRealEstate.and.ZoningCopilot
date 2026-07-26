// ============================================================
// FILE: src/utils/logging/respan-logger.ts
// Respan Observability Logger
// ============================================================

import { logger } from '../logger';

export interface RespanConfig {
  endpoint: string;
  apiKey: string;
  environment: string;
  service: string;
}

export interface RespanLogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  service: string;
  environment: string;
  agent_id?: string;
  pipeline_id?: string;
  execution_id?: string;
  latency_ms?: number;
  token_usage?: number;
  prompt_version?: string;
  metadata?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export class RespanLogger {
  private config: RespanConfig;
  private isEnabled: boolean;

  constructor(config?: Partial<RespanConfig>) {
    this.config = {
      endpoint: process.env.RESPAN_ENDPOINT || 'https://respan.realestatecopilot.ai/api/v1/telemetry',
      apiKey: process.env.RESPAN_API_KEY || '',
      environment: process.env.NODE_ENV || 'development',
      service: process.env.APP_NAME || 'realestate-copilot',
      ...config,
    };
    this.isEnabled = !!this.config.apiKey && process.env.RESPAN_ENABLE_LIVE_DASHBOARD !== 'false';
  }

  /**
   * Log an event to Respan
   */
  public async log(entry: Omit<RespanLogEntry, 'timestamp' | 'service' | 'environment'>): Promise<void> {
    if (!this.isEnabled) {
      // Fallback to local logger
      logger.debug('[Respan] Disabled, logging locally:', entry);
      return;
    }

    const logEntry: RespanLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      service: this.config.service,
      environment: this.config.environment,
    };

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Request-ID': entry.execution_id || '',
        },
        body: JSON.stringify(logEntry),
      });

      if (!response.ok) {
        logger.warn(`[Respan] Failed to log: ${response.status}`);
      }
    } catch (error) {
      // Don't let Respan failures affect the application
      logger.debug('[Respan] Logging failed:', error);
    }
  }

  /**
   * Log agent execution
   */
  public logAgentExecution(params: {
    agent_id: string;
    execution_id: string;
    pipeline_id?: string;
    status: 'started' | 'completed' | 'failed';
    latency_ms?: number;
    token_usage?: number;
    prompt_version?: string;
    metadata?: Record<string, any>;
    error?: Error;
  }): void {
    const level = params.status === 'failed' ? 'error' : 'info';
    
    this.log({
      level,
      message: `Agent ${params.status}: ${params.agent_id}`,
      agent_id: params.agent_id,
      execution_id: params.execution_id,
      pipeline_id: params.pipeline_id,
      latency_ms: params.latency_ms,
      token_usage: params.token_usage,
      prompt_version: params.prompt_version,
      metadata: params.metadata,
      error: params.error ? {
        message: params.error.message,
        stack: params.error.stack,
        code: (params.error as any).code,
      } : undefined,
    });
  }

  /**
   * Log pipeline execution
   */
  public logPipelineExecution(params: {
    pipeline_id: string;
    execution_id: string;
    status: 'started' | 'completed' | 'failed';
    total_latency_ms?: number;
    total_tokens?: number;
    stages?: Array<{
      stage_id: string;
      status: string;
      latency_ms: number;
      tokens: number;
    }>;
    error?: Error;
  }): void {
    const level = params.status === 'failed' ? 'error' : 'info';
    
    this.log({
      level,
      message: `Pipeline ${params.status}: ${params.pipeline_id}`,
      pipeline_id: params.pipeline_id,
      execution_id: params.execution_id,
      latency_ms: params.total_latency_ms,
      token_usage: params.total_tokens,
      metadata: { stages: params.stages },
      error: params.error ? {
        message: params.error.message,
        stack: params.error.stack,
      } : undefined,
    });
  }

  /**
   * Log LLM call
   */
  public logLLMCall(params: {
    execution_id: string;
    model: string;
    provider: 'minimax' | 'cerebras';
    latency_ms: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_version?: string;
    cost_estimate?: number;
    error?: Error;
  }): void {
    this.log({
      level: params.error ? 'error' : 'info',
      message: `LLM call: ${params.provider}/${params.model}`,
      execution_id: params.execution_id,
      latency_ms: params.latency_ms,
      token_usage: params.total_tokens,
      prompt_version: params.prompt_version,
      metadata: {
        model: params.model,
        provider: params.provider,
        prompt_tokens: params.prompt_tokens,
        completion_tokens: params.completion_tokens,
        cost_estimate: params.cost_estimate,
      },
      error: params.error ? {
        message: params.error.message,
        stack: params.error.stack,
      } : undefined,
    });
  }
}

export const respanLogger = new RespanLogger();

export default {
  RespanLogger,
  respanLogger,
};