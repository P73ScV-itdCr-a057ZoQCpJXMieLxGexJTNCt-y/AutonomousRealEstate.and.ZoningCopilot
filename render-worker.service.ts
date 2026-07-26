// ============================================================
// FILE: src/services/render-worker.service.ts
// Render Cron Job Worker Service
// ============================================================

import cron from 'node-cron';
import { logger } from '../utils/logger';
import { respanIntegration } from './respan-integration.service';

export interface RenderWorkerConfig {
  jobs: CronJobDefinition[];
  timezone?: string;
}

export interface CronJobDefinition {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  timeoutMinutes?: number;
  retryCount?: number;
  retryDelaySeconds?: number;
  enabled?: boolean;
  description?: string;
}

export interface CronJobResult {
  jobName: string;
  success: boolean;
  startTime: string;
  endTime: string;
  durationMs: number;
  error?: string;
  retries?: number;
}

export class RenderWorkerService {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private jobResults: CronJobResult[] = [];
  private config: RenderWorkerConfig;
  private maxHistorySize: number = 100;

  constructor(config?: Partial<RenderWorkerConfig>) {
    this.config = {
      jobs: [],
      timezone: process.env.TZ || 'UTC',
      ...config,
    };
  }

  /**
   * Register a cron job
   */
  public registerJob(job: CronJobDefinition): void {
    if (!job.enabled && job.enabled !== undefined) {
      logger.info(`[RenderWorker] Job "${job.name}" is disabled, skipping registration`);
      return;
    }

    if (this.jobs.has(job.name)) {
      logger.warn(`[RenderWorker] Job "${job.name}" already registered, overwriting`);
      this.unregisterJob(job.name);
    }

    const scheduledTask = cron.schedule(
      job.schedule,
      () => this.executeJob(job),
      {
        timezone: this.config.timezone,
        name: job.name,
      }
    );

    this.jobs.set(job.name, scheduledTask);
    
    logger.info(`[RenderWorker] Registered job: ${job.name} (${job.schedule})`);
  }

  /**
   * Register multiple jobs
   */
  public registerJobs(jobs: CronJobDefinition[]): void {
    for (const job of jobs) {
      this.registerJob(job);
    }
  }

  /**
   * Unregister a job
   */
  public unregisterJob(jobName: string): void {
    const task = this.jobs.get(jobName);
    if (task) {
      task.stop();
      this.jobs.delete(jobName);
      logger.info(`[RenderWorker] Unregistered job: ${jobName}`);
    }
  }

  /**
   * Execute a job immediately
   */
  public async executeJobNow(jobName: string): Promise<CronJobResult | null> {
    const job = this.config.jobs.find(j => j.name === jobName);
    if (!job) {
      logger.error(`[RenderWorker] Job not found: ${jobName}`);
      return null;
    }

    return this.executeJob(job);
  }

  /**
   * Execute a job with retry logic
   */
  private async executeJob(job: CronJobDefinition): Promise<CronJobResult> {
    const startTime = Date.now();
    const startDate = new Date().toISOString();
    let lastError: string | undefined;
    let retries = 0;
    const maxRetries = job.retryCount || 0;
    const retryDelay = job.retryDelaySeconds || 30;

    logger.info(`[RenderWorker] Starting job: ${job.name}`);

    // Log to Respan
    await respanIntegration.logEvent('info', `Cron job started: ${job.name}`, {
      metadata: { jobName: job.name, schedule: job.schedule },
    });

    while (retries <= maxRetries) {
      try {
        // Set timeout if configured
        if (job.timeoutMinutes) {
          const timeoutMs = job.timeoutMinutes * 60 * 1000;
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Job timed out after ${job.timeoutMinutes} minutes`)), timeoutMs);
          });

          await Promise.race([job.handler(), timeoutPromise]);
        } else {
          await job.handler();
        }

        // Success
        const result: CronJobResult = {
          jobName: job.name,
          success: true,
          startTime: startDate,
          endTime: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          retries,
        };

        this.addResult(result);
        
        logger.info(`[RenderWorker] Job completed successfully: ${job.name} (${result.durationMs}ms)`);
        
        await respanIntegration.logEvent('info', `Cron job completed: ${job.name}`, {
          metadata: {
            jobName: job.name,
            durationMs: result.durationMs,
            retries,
          },
        });

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        retries++;

        if (retries <= maxRetries) {
          logger.warn(`[RenderWorker] Job "${job.name}" failed (attempt ${retries}/${maxRetries + 1}): ${lastError}`);
          
          await respanIntegration.logEvent('warn', `Cron job retry: ${job.name}`, {
            metadata: {
              jobName: job.name,
              attempt: retries,
              maxRetries,
              error: lastError,
            },
          });

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay * 1000));
        }
      }
    }

    // All retries exhausted
    const result: CronJobResult = {
      jobName: job.name,
      success: false,
      startTime: startDate,
      endTime: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      error: lastError || 'All retries exhausted',
      retries,
    };

    this.addResult(result);

    logger.error(`[RenderWorker] Job failed after ${retries} retries: ${job.name}`, {
      error: result.error,
    });

    await respanIntegration.logEvent('error', `Cron job failed: ${job.name}`, {
      metadata: {
        jobName: job.name,
        error: result.error,
        retries,
        durationMs: result.durationMs,
      },
    });

    return result;
  }

  /**
   * Add result to history
   */
  private addResult(result: CronJobResult): void {
    this.jobResults.push(result);
    if (this.jobResults.length > this.maxHistorySize) {
      this.jobResults = this.jobResults.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get job execution history
   */
  public getHistory(jobName?: string): CronJobResult[] {
    if (jobName) {
      return this.jobResults.filter(r => r.jobName === jobName);
    }
    return [...this.jobResults];
  }

  /**
   * Get job status
   */
  public getJobStatus(jobName: string): {
    registered: boolean;
    lastRun?: CronJobResult;
    successRate?: number;
  } {
    const registered = this.jobs.has(jobName);
    const history = this.jobResults.filter(r => r.jobName === jobName);
    
    if (history.length === 0) {
      return { registered };
    }

    const lastRun = history[history.length - 1];
    const successCount = history.filter(r => r.success).length;

    return {
      registered,
      lastRun,
      successRate: (successCount / history.length) * 100,
    };
  }

  /**
   * Get all registered jobs
   */
  public getJobs(): Array<{ name: string; schedule: string; enabled: boolean; description?: string }> {
    return this.config.jobs.map(job => ({
      name: job.name,
      schedule: job.schedule,
      enabled: job.enabled !== false,
      description: job.description,
    }));
  }

  /**
   * Start all jobs
   */
  public startAll(): void {
    for (const [name, task] of this.jobs) {
      task.start();
      logger.info(`[RenderWorker] Started job: ${name}`);
    }
  }

  /**
   * Stop all jobs
   */
  public stopAll(): void {
    for (const [name, task] of this.jobs) {
      task.stop();
      logger.info(`[RenderWorker] Stopped job: ${name}`);
    }
  }

  /**
   * Get configuration
   */
  public getConfig(): RenderWorkerConfig {
    return { ...this.config };
  }
}

export const renderWorker = new RenderWorkerService();

export default {
  RenderWorkerService,
  renderWorker,
};