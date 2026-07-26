// ============================================================
// FILE: src/agents/audio/voicemail-compiler.agent.ts
// TCPA-Compliant ElevenLabs Voicemail Compiler
// Human-Realistic Audio with Regulatory Compliance
// ============================================================

import {
  VoicemailCompilerInput,
  ComplianceConfig,
  ElevenLabsConfig,
  VoicemailScript,
  ElevenLabsRequest,
  AudioGenerationResult,
  PhoneticTransformRule,
  PacingMarkerConfig,
} from './voicemail-compiler.types';

// --------------------------------------------
// ELEVENLABS VOICEMAIL COMPILER CLASS
// --------------------------------------------

export class ElevenLabsVoicemailCompiler {
  private elevenLabsConfig: ElevenLabsConfig;
  private pacingMarkers: PacingMarkerConfig;

  constructor(config: ElevenLabsConfig) {
    this.elevenLabsConfig = config;
    this.pacingMarkers = {
      pause: '[pause]',
      clears_throat: '[clears throat]',
      sighs: '[sighs]',
      slight_excitement: '[slight excitement]',
      end_of_message: '[end of message]',
    };
  }

  /**
   * Compile voicemail script with compliance and audio realism
   */
  public compile(input: VoicemailCompilerInput): AudioGenerationResult {
    console.log(`[VoicemailCompiler] Compiling script for property: ${input.property_id}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Build compliant script
      const scriptText = this.buildCompliantScript(input);

      // Validate compliance
      const validation = this.validateCompliance(scriptText, input.compliance_config);

      if (!validation.is_compliant) {
        warnings.push('Script may not be fully TCPA compliant');
        warnings.push(...validation.missing_elements);
      }

      // Estimate token usage
      const tokenEstimate = this.estimateTokens(scriptText);

      // Create script object
      const script: VoicemailScript = {
        property_id: input.property_id,
        script_text: scriptText,
        generated_timestamp: new Date().toISOString(),
        compliance_validation: validation,
        metadata: {
          density_score: input.density_score,
          fee_savings: input.fee_savings,
          shot_clock_days: input.shot_clock_days,
          token_estimate: tokenEstimate,
        },
      };

      return {
        success: true,
        script,
        audio_buffer: null,
        errors,
        warnings,
      };

    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        script: null,
        audio_buffer: null,
        errors,
        warnings,
      };
    }
  }

  /**
   * Generate audio from script using ElevenLabs API
   */
  public async generateAudio(script: VoicemailScript): Promise<Buffer> {
    console.log('[VoicemailCompiler] Generating audio via ElevenLabs...');

    const request: ElevenLabsRequest = {
      text: script.script_text,
      model_id: this.elevenLabsConfig.model_id,
      voice_settings: this.elevenLabsConfig.voice_settings,
    };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsConfig.voice_id}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsConfig.api_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return Buffer.from(audioBuffer);
  }

  /**
   * Build compliant voicemail script with required disclosures
   */
  private buildCompliantScript(input: VoicemailCompilerInput): string {
    const { lead_address, lead_city, density_score, fee_savings, shot_clock_days, compliance_config } = input;

    // Step 1: Opening disclosure (TCPA mandated)
    const disclosure = this.buildDisclosure(compliance_config, lead_address);

    // Step 2: Core value proposition
    const valueProposition = this.buildValueProposition(density_score, lead_address, fee_savings, shot_clock_days);

    // Step 3: Call to action
    const callToAction = this.buildCallToAction(density_score);

    // Step 4: Opt-out mechanism (TCPA mandated)
    const optOut = this.buildOptOut(compliance_config);

    // Step 5: Assemble with pacing markers
    const script = this.assembleWithPacing(disclosure, valueProposition, callToAction, optOut);

    // Step 6: Apply phonetic transformations
    return this.applyPhoneticTransforms(script);
  }

  /**
   * Build opening disclosure
   */
  private buildDisclosure(config: ComplianceConfig, address: string): string {
    const { entity_name, include_ai_disclosure } = config;

    let disclosure = '';

    if (include_ai_disclosure) {
      disclosure = `Hello, this is an automated message using AI-generated voice technology on behalf of ${entity_name}. [pause] We are calling regarding the property at ${address}.`;
    } else {
      disclosure = `Hello, this is a message on behalf of ${entity_name}. [pause] We are calling regarding the property at ${address}.`;
    }

    return disclosure;
  }

  /**
   * Build value proposition based on density score
   */
  private buildValueProposition(
    score: number,
    address: string,
    savings: number,
    shotClock: number
  ): string {
    let proposition = '';

    if (score >= 75) {
      proposition = `[pause] Our automated underwriting model has flagged a major density upzoning opportunity under Senate Bill seven eighty-six and Senate Bill seven nine. [clears throat] This means your property at ${address} could qualify for up to eight units and significant fee savings. [pause] We believe this could be a game-changer for your property's value.`;
      
      if (savings > 0) {
        proposition += ` [pause] Specifically, you could qualify for fee savings of approximately ${this.formatCurrencyForSpeech(savings)} and expedited approval in just ${shotClock} days under expedited review provisions. [pause] These are significant benefits worth exploring.`;
      }
    } else if (score >= 40) {
      proposition = `[pause] Our analysis indicates moderate development potential through A D U or lot split provisions. [pause] While not a major upzoning, there may still be value to unlock. [pause] We'd like to discuss this with you.`;
      
      if (savings > 0) {
        proposition += ` [pause] You could qualify for fee savings of approximately ${this.formatCurrencyForSpeech(savings)}.`;
      }
    } else {
      proposition = `[pause] While our analysis shows limited immediate development potential, we believe future zoning updates could create opportunities. [pause] We'd like to stay in touch and keep you informed.`;
    }

    return proposition;
  }

  /**
   * Build call to action
   */
  private buildCallToAction(score: number): string {
    const phone = 'four zero eight, five five five, zero one eight seven';

    if (score >= 75) {
      return `[pause] I'd love to discuss a potential acquisition or joint venture. [pause] Give me a call back at ${phone}. [pause] That's ${phone}. [pause] Hope to hear from you soon. [pause] Have a great day.`;
    } else if (score >= 40) {
      return `[pause] I'd welcome the chance to walk you through what we're seeing. [pause] It's a brief, no-obligation conversation. [pause] You can reach me at ${phone}. [pause] Again, that's ${phone}. [pause] Thanks for your time.`;
    } else {
      return `[pause] If you're open to it, I'd love to schedule a brief 10-minute call to introduce ourselves. [pause] No strings attached. [pause] You can reach me at ${phone}. [pause] That's ${phone}. [pause] Have a wonderful day.`;
    }
  }

  /**
   * Build opt-out mechanism
   */
  private buildOptOut(config: ComplianceConfig): string {
    if (!config.include_opt_out) {
      return '';
    }

    const { opt_out_key, opt_out_phrase, opt_out_phone } = config;

    return `[pause] Before you go, I want to mention that your privacy matters to us. [pause] If you would prefer not to receive future automated inquiries regarding this property, you may request to be placed on our do-not-call list at any time. [pause] You can do this by replying '${opt_out_phrase}' or by pressing ${opt_out_key} now. [pause] Alternatively, you can call us at ${this.formatPhoneNumberForSpeech(opt_out_phone)}. [pause] Either option will immediately stop all future automated communications. [pause] Thank you for your time.`;
  }

  /**
   * Assemble script with pacing markers
   */
  private assembleWithPacing(
    disclosure: string,
    valueProposition: string,
    callToAction: string,
    optOut: string
  ): string {
    let script = `${disclosure}

${valueProposition}

${callToAction}

${optOut}

[clears throat] Oh, and one more thing — [pause] I should mention that this analysis is completely confidential. [pause] We're not sharing this information with anyone else. [pause] So if you're interested, give me a ring. [pause] Thanks again, and take care.

[sighs] [end of message]`;

    // Clean up spacing
    script = script.replace(/\n{3,}/g, '\n\n').trim();

    return script;
  }

  /**
   * Apply phonetic transforms to script
   */
  private applyPhoneticTransforms(script: string): string {
    let transformed = script;

    // Define transform rules
    const rules: PhoneticTransformRule[] = [
      {
        pattern: /\bAPN\s+([A-Z0-9-]+)/gi,
        replacement: (_match: string, code: string) => {
          const phonetic = code.split('').join(' ');
          return `A P N ${phonetic}`;
        },
        description: 'APN numbers',
      },
      {
        pattern: /\bAPN\b/gi,
        replacement: 'A P N',
        description: 'APN acronym',
      },
      {
        pattern: /\bSB\s+(\d{3})\b/gi,
        replacement: (_match: string, num: string) => {
          const digits = num.split('').join(' ');
          return `Senate Bill ${digits}`;
        },
        description: 'SB bills',
      },
      {
        pattern: /\bAB\s+(\d{3})\b/gi,
        replacement: (_match: string, num: string) => {
          const digits = num.split('').join(' ');
          return `Assembly Bill ${digits}`;
        },
        description: 'AB bills',
      },
      {
        pattern: /\bECRSP\b/gi,
        replacement: 'E C R S P',
        description: 'ECRSP acronym',
      },
      {
        pattern: /\bLSAP\b/gi,
        replacement: 'L S A P',
        description: 'LSAP acronym',
      },
      {
        pattern: /\bLIHTC\b/gi,
        replacement: 'L I H T C',
        description: 'LIHTC acronym',
      },
      {
        pattern: /\bADU\b/gi,
        replacement: 'A D U',
        description: 'ADU acronym',
      },
      {
        pattern: /\bDU\/AC\b/gi,
        replacement: 'dwelling units per acre',
        description: 'DU/AC',
      },
      {
        pattern: /\bsqft\b/gi,
        replacement: 'square feet',
        description: 'sqft',
      },
      {
        pattern: /\bft\b/gi,
        replacement: 'feet',
        description: 'ft',
      },
      {
        pattern: /\bTCPA\b/gi,
        replacement: 'T C P A',
        description: 'TCPA acronym',
      },
      {
        pattern: /\bFCC\b/gi,
        replacement: 'F C C',
        description: 'FCC acronym',
      },
      {
        pattern: /\bDNC\b/gi,
        replacement: 'D N C',
        description: 'DNC acronym',
      },
    ];

    // Apply all rules
    for (const rule of rules) {
      if (typeof rule.replacement === 'string') {
        transformed = transformed.replace(rule.pattern, rule.replacement);
      } else {
        transformed = transformed.replace(rule.pattern, rule.replacement);
      }
    }

    // Format currency for speech
    transformed = transformed.replace(
      /\$([\d,]+)\s*(\w+)?/g,
      (_match, amount, suffix) => {
        const formatted = this.formatCurrencyForSpeech(parseInt(amount.replace(/,/g, '')));
        return suffix ? `${formatted} ${suffix}` : formatted;
      }
    );

    // Ensure proper pacing markers
    transformed = transformed
      .replace(/(\.\s+)/g, '$1[pause] ')
      .replace(/(\?\s+)/g, '$1[pause] ')
      .replace(/(\,\s+)/g, '$1[pause] ')
      .replace(/(\:)/g, '$1[pause]')
      .replace(/(\-\s+)/g, '[pause] ')
      .replace(/(\n\s*)/g, ' [pause] ')
      .replace(/([.!?])\s+([A-Z])/g, '$1 [pause] $2');

    // Remove duplicate markers
    transformed = transformed
      .replace(/\[pause\]\s*\[pause\]/g, '[pause] ')
      .replace(/\[clears throat\]\s*\[clears throat\]/g, '[clears throat] ')
      .replace(/\[sighs\]\s*\[sighs\]/g, '[sighs] ');

    return transformed.trim();
  }

  /**
   * Validate TCPA compliance
   */
  private validateCompliance(script: string, config: ComplianceConfig): {
    is_compliant: boolean;
    missing_elements: string[];
    has_ai_disclosure: boolean;
    has_opt_out: boolean;
    has_entity_identification: boolean;
    has_pacing_markers: boolean;
  } {
    const missing: string[] = [];

    const hasAiDisclosure = script.toLowerCase().includes('automated message') ||
                            script.toLowerCase().includes('ai-generated');

    const hasOptOut = script.toLowerCase().includes('do-not-call') ||
                      script.toLowerCase().includes('opt out') ||
                      script.toLowerCase().includes(`press ${config.opt_out_key}`) ||
                      script.toLowerCase().includes('reply') && script.toLowerCase().includes(config.opt_out_phrase);

    const hasEntity = script.toLowerCase().includes('on behalf of') ||
                      script.toLowerCase().includes(config.entity_name.toLowerCase());

    const hasPacing = script.includes('[pause]') &&
                      (script.includes('[clears throat]') || script.includes('[sighs]'));

    if (config.include_ai_disclosure && !hasAiDisclosure) {
      missing.push('AI disclosure not found');
    }

    if (config.include_opt_out && !hasOptOut) {
      missing.push('Opt-out mechanism not found');
    }

    if (!hasEntity) {
      missing.push('Entity identification not found');
    }

    if (!hasPacing) {
      missing.push('Pacing markers missing or incomplete');
    }

    return {
      is_compliant: missing.length === 0,
      missing_elements: missing,
      has_ai_disclosure: hasAiDisclosure,
      has_opt_out: hasOptOut,
      has_entity_identification: hasEntity,
      has_pacing_markers: hasPacing,
    };
  }

  /**
   * Format currency for speech
   */
  private formatCurrencyForSpeech(amount: number): string {
    if (amount >= 1000000) {
      const millions = amount / 1000000;
      return `${millions.toFixed(1)} million dollars`;
    } else if (amount >= 1000) {
      const thousands = amount / 1000;
      return `${thousands.toFixed(0)} thousand dollars`;
    }
    return `${amount} dollars`;
  }

  /**
   * Format phone number for speech
   */
  private formatPhoneNumberForSpeech(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits[0]}${digits[1]}${digits[2]} ${digits[3]}${digits[4]}${digits[5]} ${digits[6]}${digits[7]}${digits[8]}${digits[9]}`;
    }
    return phone;
  }

  /**
   * Estimate token usage
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Get configuration
   */
  public getConfig(): ElevenLabsConfig {
    return this.elevenLabsConfig;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ElevenLabsConfig>): void {
    this.elevenLabsConfig = { ...this.elevenLabsConfig, ...config };
  }
}

// --------------------------------------------
// FACTORY FUNCTION
// --------------------------------------------

export function createVoicemailCompiler(config?: Partial<ElevenLabsConfig>): ElevenLabsVoicemailCompiler {
  const defaultConfig: ElevenLabsConfig = {
    api_key: process.env.ELEVENLABS_API_KEY || '',
    voice_id: 'pNInz6obpgmA513eg5Wx',
    model_id: 'eleven_flash_v2_5',
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.1,
      use_speaker_boost: true,
    },
    output_format: 'mp3',
  };

  return new ElevenLabsVoicemailCompiler({
    ...defaultConfig,
    ...config,
  });
}

export default ElevenLabsVoicemailCompiler;