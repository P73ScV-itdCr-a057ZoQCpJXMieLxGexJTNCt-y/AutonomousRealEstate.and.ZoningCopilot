// ============================================================
// FILE: src/agents/reasoning/minimax-reasoner.agent.ts
// MiniMax M3 Reasoner with Pricing Intelligence
// ============================================================

import {
  MiniMaxConfig,
  MiniMaxRequest,
  MiniMaxResponse,
  MiniMaxTool,
  ZoningReasonerInput,
  ZoningReasonerOutput,
  MunicipalityContext,
  SpecificPlan,
  StatutoryFramework,
} from './minimax-reasoner.types';

import { DevelopmentLead } from '../../schemas/data-engine.schema';
import { SPECIFIC_PLANS, getSpecificPlansByCity } from './zoning-context/specific-plans';
import { STATUTORY_FRAMEWORK } from './zoning-context/statutory-framework';
import { MUNICIPALITY_DATA, getMunicipalityData } from './zoning-context/municipality-data';
import { PricingEngine, pricingEngine, DealScoreOutput } from '../../services/pricing-engine.service';
import { logger } from '../../utils/logger';

// --------------------------------------------
// MINIMAX M3 REASONER CLASS WITH PRICING
// --------------------------------------------

export class MiniMaxReasoner {
  private config: MiniMaxConfig;
  private useCerebras: boolean = false;
  private pricing: PricingEngine;

  constructor(config: MiniMaxConfig) {
    this.config = config;
    this.pricing = pricingEngine;
  }

  /**
   * Initialize the reasoner with Cerebras routing if enabled
   */
  public async initialize(): Promise<void> {
    console.log(`[MiniMax] Initializing M3 Reasoner...`);
    console.log(`[MiniMax] Context window: ${this.config.context_window} tokens`);
    console.log(`[MiniMax] Cerebras routing: ${this.config.cerebras_enabled ? 'ENABLED' : 'DISABLED'}`);
    
    if (this.config.cerebras_enabled) {
      this.useCerebras = true;
      console.log('[MiniMax] Cerebras ultra-fast routing configured');
    }
  }

  /**
   * Primary reasoning method - analyzes property for density potential with pricing
   */
  public async reason(input: ZoningReasonerInput): Promise<ZoningReasonerOutput> {
    console.log(`[MiniMax] Reasoning on property: ${input.lead.property_id}`);

    // Step 1: Build context for the model
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);

    // Step 2: Prepare tools for function calling
    const tools = this.prepareTools();

    // Step 3: Make API request to MiniMax M3
    const response = await this.callMiniMaxAPI(systemPrompt, userPrompt, tools);

    // Step 4: Parse and validate response
    const output = this.parseResponse(response, input.lead.property_id);

    // Step 5: Enrich with pricing intelligence
    const enrichedOutput = await this.enrichWithPricing(output, input.lead);

    return enrichedOutput;
  }

  /**
   * Enrich reasoning output with pricing intelligence
   */
  private async enrichWithPricing(
    output: ZoningReasonerOutput,
    lead: DevelopmentLead
  ): Promise<ZoningReasonerOutput> {
    try {
      // Detect specific plan
      const specificPlan = this.detectSpecificPlan(lead);
      
      // Get pricing estimate
      const pricing = this.pricing.estimateValue({
        sqft: lead.lot_size_sqft || 2000,
        city: lead.city,
        lotSize: lead.lot_size_sqft,
        isNewConstruction: true,
        specificPlan,
        builder: this.detectBuilder(lead),
      });

      // Calculate deal score
      const estimatedListingPrice = lead.lot_size_sqft * 1000;
      const dealScore = this.pricing.calculateDealScore(estimatedListingPrice, {
        sqft: lead.lot_size_sqft || 2000,
        city: lead.city,
        lotSize: lead.lot_size_sqft,
        isNewConstruction: true,
        specificPlan,
        builder: this.detectBuilder(lead),
      });

      // Enhance investment thesis with pricing data
      const pricingThesis = this.generatePricingThesis(pricing, dealScore);

      return {
        ...output,
        investment_thesis: `${output.investment_thesis}\n\n**Pricing Intelligence:** ${pricingThesis}`,
        detailed_analysis: {
          ...output.detailed_analysis,
          financial_analysis: {
            ...output.detailed_analysis.financial_analysis,
            estimated_market_value: pricing.estimatedMarketValue,
            price_per_sqft: pricing.pricePerSqft,
            city_premium: pricing.cityAdjustment,
            location_premium_pct: pricing.locationPremium,
            deal_score: dealScore.dealScore,
            pending_probability: dealScore.pendingProbability,
            recommendation: dealScore.recommendation,
          },
        },
        equity_incentive_summary: {
          ...output.equity_incentive_summary,
          estimated_value: pricing.estimatedMarketValue,
          deal_score: dealScore.dealScore,
        },
      };
    } catch (error) {
      logger.warn(`[MiniMax] Failed to enrich with pricing: ${error}`);
      return output;
    }
  }

  /**
   * Generate pricing thesis
   */
  private generatePricingThesis(pricing: any, dealScore: DealScoreOutput): string {
    const valueStr = `$${(pricing.estimatedMarketValue / 1000000).toFixed(1)}M`;
    const pricePerSqftStr = `$${pricing.pricePerSqft}/sqft`;
    const premiumStr = pricing.cityAdjustment > 0 ? `+$${(pricing.cityAdjustment / 1000000).toFixed(1)}M` : `-$${(Math.abs(pricing.cityAdjustment) / 1000000).toFixed(1)}M`;
    
    let recommendationText = '';
    switch (dealScore.recommendation) {
      case 'strong_buy': recommendationText = '🔴 STRONG BUY - significantly underpriced'; break;
      case 'buy': recommendationText = '🟢 BUY - good value'; break;
      case 'fair': recommendationText = '🟡 FAIR - market price'; break;
      case 'overpriced': recommendationText = '🟠 OVERPRICED - above market'; break;
      case 'avoid': recommendationText = '🔴 AVOID - significantly overpriced'; break;
    }

    return `Estimated market value: ${valueStr} (${pricePerSqftStr}). ` +
           `City premium: ${premiumStr} vs San Jose. ` +
           `Deal score: ${dealScore.dealScore.toFixed(2)} (${recommendationText}). ` +
           `Probability of pending: ${dealScore.pendingProbability}%.`;
  }

  /**
   * Detect specific plan from lead
   */
  private detectSpecificPlan(lead: DevelopmentLead): 'ECRSP' | 'LSAP' | 'none' {
    const text = lead.recent_signal_text?.toLowerCase() || '';
    const address = lead.address?.toLowerCase() || '';
    
    if (text.includes('ecrsp') || text.includes('el camino real') || address.includes('el camino real')) {
      return 'ECRSP';
    }
    if (text.includes('lsap') || text.includes('lawrence station') || address.includes('althea ter')) {
      return 'LSAP';
    }
    return 'none';
  }

  /**
   * Detect builder from lead
   */
  private detectBuilder(lead: DevelopmentLead): string | undefined {
    const text = lead.recent_signal_text || '';
    
    const builders = ['Toll Brothers', 'Pulte', 'Thomas James', 'Intero', 'Compass', 'Coldwell Banker'];
    for (const builder of builders) {
      if (text.includes(builder)) {
        return builder;
      }
    }
    return undefined;
  }

  /**
   * Build the system prompt with legal and analytical instructions
   */
  private buildSystemPrompt(): string {
    return `You are the Lead Underwriter and Policy Analyst for the Autonomous Real Estate Development & Zoning Co-Pilot.

ROLE: Expert in California land-use law, municipal zoning ordinances, structural wealth-distribution dynamics, and affordable housing finance.

CONTEXT: You have access to:
1. California state statutory framework (SB 79, SB 786, SB 808, AB 712, SB 9, SB 330)
2. Federal 21st Century ROAD to Housing Act provisions
3. Local Specific Plans (ECRSP, LSAP, Downtown Core, etc.)
4. Municipality wealth and exclusionary zoning data
5. Pricing intelligence from Santa Clara County market data

TASK OBJECTIVES:

1. COMPUTE EXCLUSIONARY INDEX (1-100):
   - Baseline: 50
   - +20 if neighborhood median income > county baseline × 1.5
   - +15 if zoning_restrictiveness is "Severe"
   - +15 if area is >80% single-family homes (estimated from zoning)
   - +10 if last housing element update > 5 years ago
   - -10 if specific plan is active in area
   - -10 if transit-oriented development is permitted

2. EVALUATE LEGAL INTERVENTION OVERRIDES:
   - Check if parcel is within Specific Plan area (ECRSP, LSAP, etc.)
   - Check if within 500m of a Caltrain/transit hub
   - Apply SB 786 to override restrictive local zoning
   - Apply SB 79 transit overlay density bonus (up to 50% increase)
   - Bypass minimum lot size restrictions if applicable
   - Enable vertical density (6+ stories) if applicable

3. CALCULATE DENSITY_ADD_SCORE (1-100):
   - Baseline from current zoning:
     * R-1/R-2: 30
     * R-3/R-4: 50
     * Commercial/Mixed-Use: 60
     * OS/Protected: 0
   - Add for overrides:
     * SB 786 override: +25
     * Transit-oriented radius: +20
     * Specific plan eligibility: +15
   - Adjust for lot size:
     * >10,000 sqft: +10
     * 5,000-10,000 sqft: 0
     * <5,000 sqft: -10
   - Equity incentive multipliers:
     * If affordable housing included: +10
     * If LIHTC eligible: +5
     * If ROAD Act Title 9 applies: +5

4. GENERATE INVESTMENT THESIS:
   - 3 concise sentences explaining:
     1) The density opportunity
     2) The legal pathway being used
     3) The financial/equity impact

OUTPUT: Return ONLY valid JSON matching the ZoningReasonerOutput schema.

CRITICAL RULES:
- DO NOT hallucinate legal provisions. Only apply laws explicitly provided.
- If no overrides apply, density_add_score should remain low.
- Exclusionary_index should reflect real systemic barriers.
- Investment thesis must be grounded in the legal analysis.`;
  }

  /**
   * Build the user prompt with property, context, and pricing data
   */
  private buildUserPrompt(input: ZoningReasonerInput): string {
    const { lead, municipality_context, specific_plans, statutory_framework } = input;

    // Get pricing intelligence
    const pricing = this.pricing.estimateValue({
      sqft: lead.lot_size_sqft || 2000,
      city: lead.city,
      lotSize: lead.lot_size_sqft,
      isNewConstruction: true,
    });

    let prompt = `PROPERTY DATA:\n`;
    prompt += `- Property ID: ${lead.property_id}\n`;
    prompt += `- Address: ${lead.address}\n`;
    prompt += `- City: ${lead.city}\n`;
    prompt += `- Current Zoning: ${lead.current_zoning}\n`;
    prompt += `- Lot Size: ${lead.lot_size_sqft} sqft\n`;
    prompt += `- Recent Signal: "${lead.recent_signal_text}"\n`;
    prompt += `- Signal Date: ${lead.signal_date}\n\n`;

    prompt += `PRICING INTELLIGENCE:\n`;
    prompt += `- Estimated Market Value: $${pricing.estimatedMarketValue.toLocaleString()}\n`;
    prompt += `- Price per Sqft: $${pricing.pricePerSqft}\n`;
    prompt += `- City Premium: $${pricing.cityAdjustment.toLocaleString()}\n`;
    prompt += `- Location Premium: ${pricing.locationPremium}%\n`;
    prompt += `- Confidence Score: ${pricing.confidenceScore}%\n\n`;

    prompt += `MUNICIPALITY CONTEXT:\n`;
    prompt += `- Median Income: $${municipality_context.median_household_income.toLocaleString()}\n`;
    prompt += `- County Baseline: $${municipality_context.county_baseline_income.toLocaleString()}\n`;
    prompt += `- Zoning Restrictiveness: ${municipality_context.zoning_restrictiveness}\n`;
    prompt += `- Housing Element Status: ${municipality_context.housing_element_status}\n`;
    prompt += `- Exclusionary Zoning Score: ${municipality_context.exclusionary_zoning_score}/100\n\n`;

    prompt += `SPECIFIC PLANS:\n`;
    if (specific_plans.length > 0) {
      for (const plan of specific_plans) {
        prompt += `- ${plan.name}: ${plan.allowed_du_per_acre} DU/AC, ${plan.max_stories} stories, ${plan.status}\n`;
      }
    } else {
      prompt += `- No active specific plans for this municipality\n`;
    }
    prompt += `\n`;

    prompt += `STATUTORY FRAMEWORK:\n`;
    prompt += `- SB 79 Transit Overlay: ${statutory_framework.sb_79.transit_overlay_active ? 'Active' : 'Inactive'}\n`;
    prompt += `- SB 786 Inconsistency Override: ${statutory_framework.sb_786.inconsistency_override_active ? 'Active' : 'Inactive'}\n`;
    prompt += `- SB 808 Shot Clock: ${statutory_framework.sb_808.expedited_shot_clock_days} days\n`;
    prompt += `- ROAD Act Title 9 Cap: ${(statutory_framework.federal_road_act_2026.title_9_welfare_cap_percentage * 100)}%\n\n`;

    prompt += `TASK: Analyze this property and provide a structured JSON output with exclusionary_index, density_add_score, statutory_pathway, equity_incentive_summary, and investment_thesis. Consider the pricing intelligence in your analysis.`;

    return prompt;
  }

  /**
   * Prepare tools for function calling
   */
  private prepareTools(): MiniMaxTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'calculate_exclusionary_index',
          description: 'Calculate the exclusionary index (1-100) for a property based on municipality data',
          parameters: {
            type: 'object',
            properties: {
              median_income: { type: 'number' },
              county_baseline: { type: 'number' },
              zoning_restrictiveness: { type: 'string', enum: ['Severe', 'Moderate', 'Low', 'Open'] },
              housing_element_status: { type: 'string', enum: ['Compliant', 'Non-Compliant', 'Under Review'] },
              has_specific_plan: { type: 'boolean' },
              is_transit_oriented: { type: 'boolean' },
            },
            required: ['median_income', 'county_baseline', 'zoning_restrictiveness'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'evaluate_legal_overrides',
          description: 'Evaluate applicable legal overrides (SB 786, SB 79, specific plans)',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              current_zoning: { type: 'string' },
              lot_size: { type: 'number' },
              is_near_transit: { type: 'boolean' },
              specific_plans: { type: 'array', items: { type: 'object' } },
            },
            required: ['city', 'current_zoning'],
          },
        },
      },
    ];
  }

  // ... rest of existing methods (callMiniMaxAPI, callCerebrasAPI, parseResponse, etc.) ...

  private async callMiniMaxAPI(
    systemPrompt: string,
    userPrompt: string,
    tools: MiniMaxTool[]
  ): Promise<MiniMaxResponse> {
    // ... existing implementation ...
    return {} as MiniMaxResponse;
  }

  private async callCerebrasAPI(systemPrompt: string, userPrompt: string): Promise<MiniMaxResponse> {
    // ... existing implementation ...
    return {} as MiniMaxResponse;
  }

  private parseResponse(response: MiniMaxResponse, propertyId: string): ZoningReasonerOutput {
    // ... existing implementation ...
    return {} as ZoningReasonerOutput;
  }

  /**
   * Batch process multiple leads with pricing enrichment
   */
  public async batchReason(leads: DevelopmentLead[]): Promise<ZoningReasonerOutput[]> {
    console.log(`[MiniMax] Batch reasoning on ${leads.length} properties`);
    
    const results: ZoningReasonerOutput[] = [];
    const batchSize = 5; // Rate limit: 5 concurrent
    
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      const batchPromises = batch.map(lead => this.reasonForLead(lead));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    // Sort by deal score (best deals first)
    results.sort((a, b) => {
      const scoreA = a.detailed_analysis?.financial_analysis?.deal_score || 1;
      const scoreB = b.detailed_analysis?.financial_analysis?.deal_score || 1;
      return scoreA - scoreB;
    });
    
    console.log(`[MiniMax] Batch reasoning complete: ${results.length} outputs`);
    return results;
  }

  /**
   * Helper: Build input for a single lead with pricing
   */
  private async reasonForLead(lead: DevelopmentLead): Promise<ZoningReasonerOutput> {
    // Get municipality context
    const municipalityContext = getMunicipalityData(lead.city) || {
      city: lead.city,
      county: 'Santa Clara',
      median_household_income: 142000,
      county_baseline_income: 142000,
      zoning_restrictiveness: 'Moderate',
      housing_element_status: 'Under Review',
      last_housing_element_update: new Date().toISOString(),
      adu_compliance_violation: false,
      sb9_implementation: 'Partially Implemented',
      exclusionary_zoning_score: 50,
      area_median_home_price: 1500000,
      population: 0,
      housing_unit_count: 0,
      rent_burden_percentage: 30,
    };

    // Get specific plans for the city
    const specificPlans = getSpecificPlansByCity(lead.city);

    const input: ZoningReasonerInput = {
      lead,
      municipality_context: municipalityContext,
      specific_plans: specificPlans,
      statutory_framework: STATUTORY_FRAMEWORK,
    };

    return this.reason(input);
  }

  /**
   * Get current configuration
   */
  public getConfig(): MiniMaxConfig {
    return this.config;
  }

  /**
   * Enable/disable Cerebras routing
   */
  public setCerebrasEnabled(enabled: boolean): void {
    this.config.cerebras_enabled = enabled;
    this.useCerebras = enabled;
  }
}

// --------------------------------------------
// FACTORY FUNCTION
// --------------------------------------------

export function createMiniMaxReasoner(config?: Partial<MiniMaxConfig>): MiniMaxReasoner {
  const defaultConfig: MiniMaxConfig = {
    api_key: process.env.MINIMAX_API_KEY || '',
    api_url: process.env.MINIMAX_API_URL || 'https://api.minimax.ai/v1/chat/completions',
    model: 'minimax_m3',
    context_window: 1000000,
    temperature: 0.2,
    max_tokens: 4096,
    top_p: 0.95,
    top_k: 40,
    cerebras_enabled: true,
    cerebras_endpoint: process.env.CEREBRAS_API_URL || 'https://api.cerebras.ai/v1/completions',
    cerebras_fallback_threshold_ms: 2000,
  };

  return new MiniMaxReasoner({
    ...defaultConfig,
    ...config,
  });
}

export default MiniMaxReasoner;