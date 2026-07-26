// ============================================================
// FILE: src/agents/transformation/nexla-transformer.agent.ts
// Nexla Data Transformer Agent
// Enterprise-grade data integration for AI agents
// ============================================================

import {
  NexlaConfig,
  NexlaConnection,
  NexsetDefinition,
  DataValidationResult,
  HelixContext,
  MCPToolDefinition
} from './nexla-transformer.types';

import { DevelopmentLead, parseToDevelopmentLead } from '../../schemas/data-engine.schema';
import { ScrapedDocument } from '../ingestion/rtrvr-scraper.types';

// --------------------------------------------
// NEXLA TRANSFORMER AGENT CLASS
// --------------------------------------------

export class NexlaTransformerAgent {
  private config: NexlaConfig;
  private connections: Map<string, NexlaConnection> = new Map();
  private nexsets: Map<string, NexsetDefinition> = new Map();
  private isInitialized: boolean = false;

  constructor(config: NexlaConfig) {
    this.config = config;
  }

  /**
   * Initialize Nexla connections and data products
   * Connects to 1000+ enterprise systems via Nexla's fabric
   */
  public async initialize(): Promise<void> {
    console.log('[Nexla] Initializing data fabric...');

    try {
      // Establish connections to data sources
      await this.establishConnections();
      
      // Define or discover Nexsets (governed data products)
      await this.defineNexsets();
      
      // Set up Helix context layer for semantic enrichment
      await this.initializeHelixContext();

      this.isInitialized = true;
      console.log('[Nexla] Data fabric initialized successfully');
    } catch (error) {
      console.error('[Nexla] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Establish connections to enterprise systems
   * Uses Nexla's 1000+ bidirectional connectors
   */
  private async establishConnections(): Promise<void> {
    // Source 1: Scraped municipal data feed
    const municipalFeedConnection: NexlaConnection = {
      id: 'municipal_feed_conn',
      type: 'http_poll',
      config: {
        url: this.config.municipal_feed_url || 'https://api.rtrvr.ai/scrape',
        auth: {
          type: 'api_key',
          credentials_key: 'RTRVR_API_KEY',
        },
        poll_interval_seconds: 300,
        retry_policy: {
          max_retries: 3,
          backoff_seconds: 30,
        },
      },
      schema: {
        fields: [
          { name: 'property_id', type: 'string', required: true },
          { name: 'address', type: 'string', required: true },
          { name: 'city', type: 'string', required: true },
          { name: 'current_zoning', type: 'string' },
          { name: 'lot_size_sqft', type: 'number' },
          { name: 'recent_signal_text', type: 'string' },
          { name: 'signal_date', type: 'datetime' },
        ],
      },
    };

    // Source 2: Property parcel database
    const parcelDatabaseConnection: NexlaConnection = {
      id: 'parcel_db_conn',
      type: 'database',
      config: {
        connection_string: process.env.DATABASE_URL || 'postgres://localhost:5432/parcel_db',
        auth: {
          type: 'basic',
          credentials_key: 'DATABASE_CREDENTIALS',
        },
        sync_mode: 'incremental',
        poll_interval_seconds: 3600,
      },
      schema: {
        fields: [
          { name: 'property_id', type: 'string', required: true },
          { name: 'address', type: 'string', required: true },
          { name: 'city', type: 'string', required: true },
          { name: 'county', type: 'string' },
          { name: 'state', type: 'string' },
          { name: 'zip_code', type: 'string' },
          { name: 'current_zoning', type: 'string', required: true },
          { name: 'lot_size_sqft', type: 'number', required: true },
          { name: 'latitude', type: 'number' },
          { name: 'longitude', type: 'number' },
          { name: 'base_density_allowed', type: 'number' },
          { name: 'last_assessed_value', type: 'number' },
          { name: 'owner_name', type: 'string' },
        ],
      },
    };

    // Register connections
    this.connections.set('municipal_feed', municipalFeedConnection);
    this.connections.set('parcel_database', parcelDatabaseConnection);

    // Use Nexla's Agentic Probe to discover additional data entities
    await this.runAgenticProbe();
  }

  /**
   * Run Nexla's Agentic Probe for data discovery
   * Automatically scans for high-value data candidates
   */
  private async runAgenticProbe(): Promise<void> {
    console.log('[Nexla] Running Agentic Probe for data discovery...');

    // In production: Call Nexla API to run probe
    // const probeResults = await this.nexlaApi.probe({
    //   connections: Array.from(this.connections.keys()),
    //   evaluation_criteria: ['business_relevance', 'tool_candidacy']
    // });

    // Mock probe discovery
    const discoveredEntities = [
      {
        name: 'zoning_ordinances',
        type: 'document_collection',
        source: 'municipal_feed',
        relevance_score: 0.95,
        recommended_as: 'mcp_tool',
      },
      {
        name: 'property_tax_records',
        type: 'dataset',
        source: 'parcel_database',
        relevance_score: 0.88,
        recommended_as: 'nexset',
      },
    ];

    console.log(`[Nexla] Agentic Probe discovered ${discoveredEntities.length} high-value data entities`);
  }

  /**
   * Define Nexsets (governed data products)
   * Creates reusable, governed data products for agents
   */
  private async defineNexsets(): Promise<void> {
    console.log('[Nexla] Defining Nexsets...');

    // Primary Nexset: DevelopmentLead
    const developmentLeadNexset: NexsetDefinition = {
      id: 'development_leads_v1',
      name: 'Development Leads',
      description: 'Governed data product for real estate development opportunities',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          property_id: { type: 'string', description: 'Assessor Parcel Number (APN)' },
          address: { type: 'string', description: 'Full property address' },
          city: { type: 'string', description: 'Municipality' },
          current_zoning: { type: 'string', description: 'Current zoning classification' },
          lot_size_sqft: { type: 'number', description: 'Total lot size in square feet' },
          recent_signal_text: { type: 'string', description: 'Raw signal from municipal feed' },
          signal_date: { type: 'string', format: 'date-time' },
          exclusionary_index: { type: 'number', minimum: 0, maximum: 100 },
          density_add_score: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['property_id', 'address', 'city', 'current_zoning', 'lot_size_sqft'],
      },
      sources: ['municipal_feed', 'parcel_database'],
      transformation_rules: [
        {
          field: 'property_id',
          source: 'municipal_feed.apn',
          transform: 'direct',
        },
        {
          field: 'address',
          source: 'municipal_feed.address',
          transform: 'direct',
        },
        {
          field: 'city',
          source: 'municipal_feed.city',
          transform: 'direct',
        },
        {
          field: 'current_zoning',
          source: 'parcel_database.current_zoning',
          transform: 'direct',
          fallback: 'municipal_feed.zoning_code',
        },
        {
          field: 'lot_size_sqft',
          source: 'parcel_database.lot_size_sqft',
          transform: 'direct',
        },
        {
          field: 'recent_signal_text',
          source: 'municipal_feed.recent_signal_text',
          transform: 'truncate',
          params: { max_length: 500 },
        },
        {
          field: 'signal_date',
          source: 'municipal_feed.signal_date',
          transform: 'parse_date',
          params: { format: 'iso8601' },
        },
      ],
      governance: {
        access_control: {
          roles: ['analyst', 'developer', 'admin'],
          permissions: ['read', 'write', 'admin'],
        },
        data_quality: {
          required_fields: ['property_id', 'address', 'city'],
          validation_rules: {
            property_id: { pattern: '^[A-Z0-9-]{6,15}$' },
            lot_size_sqft: { min: 0 },
            exclusionary_index: { min: 0, max: 100 },
            density_add_score: { min: 0, max: 100 },
          },
        },
        lineage: {
          track_sources: true,
          audit_log: true,
          retention_days: 365,
        },
        pii_protection: {
          enabled: true,
          fields_to_mask: ['owner_name', 'owner_address'],
        },
      },
      lifecycle: {
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        owner: 'data_engineering_team',
      },
    };

    // Secondary Nexset: ZoningContext
    const zoningContextNexset: NexsetDefinition = {
      id: 'zoning_context_v1',
      name: 'Zoning Context & Specific Plans',
      description: 'Municipal zoning ordinances and specific plans for equity analysis',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          municipality: { type: 'string' },
          specific_plan_name: { type: 'string' },
          allowed_du_per_acre: { type: 'number' },
          max_stories: { type: 'number' },
          height_limit_feet: { type: 'number' },
          transit_radius_meters: { type: 'number' },
          affordable_housing_percentage: { type: 'number' },
          fee_reductions: { type: 'array', items: { type: 'string' } },
        },
        required: ['municipality'],
      },
      sources: ['municipal_feed'],
      transformation_rules: [
        {
          field: 'municipality',
          source: 'municipal_feed.city',
          transform: 'direct',
        },
        {
          field: 'specific_plan_name',
          source: 'municipal_feed.specific_plan',
          transform: 'extract_from_text',
          params: { pattern: '(ECRSP|LSAP|Specific Plan)' },
        },
      ],
      governance: {
        access_control: {
          roles: ['analyst', 'developer'],
          permissions: ['read'],
        },
        data_quality: {
          required_fields: ['municipality'],
        },
        lineage: {
          track_sources: true,
          audit_log: true,
          retention_days: 365,
        },
      },
      lifecycle: {
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        owner: 'data_engineering_team',
      },
    };

    this.nexsets.set('development_leads', developmentLeadNexset);
    this.nexsets.set('zoning_context', zoningContextNexset);

    console.log(`[Nexla] Defined ${this.nexsets.size} Nexsets`);
  }

  /**
   * Initialize Helix Context Layer
   * Provides semantic enrichment and context for agents
   */
  private async initializeHelixContext(): Promise<void> {
    console.log('[Nexla] Initializing Helix Context Layer...');

    // Helix enriches data with:
    // 1. Semantic metadata
    // 2. Relationships between entities
    // 3. Document context (PDFs, policy files)
    // 4. Pipeline history and lineage
    // 5. Web search results

    const helixConfig: HelixContext = {
      enabled: true,
      enrichment_engines: [
        {
          type: 'semantic',
          config: {
            map_fields_to_ontology: true,
            infer_relationships: true,
          },
        },
        {
          type: 'document',
          config: {
            sources: ['zoning_ordinances', 'city_council_minutes'],
            embedding_model: 'text-embedding-3-small',
            vector_db: 'pinecone',
          },
        },
        {
          type: 'search',
          config: {
            enabled: true,
            sources: ['web', 'internal_docs'],
            max_results: 5,
          },
        },
      ],
      knowledge_graph: {
        enabled: true,
        store: 'neo4j',
        nodes: ['parcel', 'zoning_code', 'municipality', 'developer', 'property_owner'],
        relationships: ['zoned_as', 'located_in', 'regulated_by', 'owned_by'],
      },
    };

    console.log('[Nexla] Helix Context Layer initialized with:', JSON.stringify(helixConfig, null, 2));
  }

  /**
   * Transform scraped data to DevelopmentLead
   * Primary transformation method using Nexla data products
   */
  public async transformToDevelopmentLead(
    scrapedDocuments: ScrapedDocument[]
  ): Promise<DevelopmentLead[]> {
    if (!this.isInitialized) {
      throw new Error('Nexla transformer not initialized. Call initialize() first.');
    }

    console.log(`[Nexla] Transforming ${scrapedDocuments.length} documents to DevelopmentLead...`);

    const leads: DevelopmentLead[] = [];

    for (const doc of scrapedDocuments) {
      try {
        // Step 1: Validate input against schema
        const validationResult = await this.validateData(doc);
        if (!validationResult.isValid) {
          console.warn(`[Nexla] Validation failed for document ${doc.doc_id}:`, validationResult.errors);
          continue;
        }

        // Step 2: Enrich with parcel database
        const enriched = await this.enrichWithParcelData(doc);

        // Step 3: Apply transformation rules from Nexset
        const transformed = await this.applyNexsetTransformations(enriched);

        // Step 4: Add Helix context (semantic enrichment)
        const withContext = await this.enrichWithHelixContext(transformed);

        leads.push(withContext);
      } catch (error) {
        console.error(`[Nexla] Transformation failed for ${doc.doc_id}:`, error);
      }
    }

    console.log(`[Nexla] Successfully transformed ${leads.length} leads`);
    return leads;
  }

  /**
   * Validate data against schema
   */
  private async validateData(data: any): Promise<DataValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields check
    const required = ['property_id', 'address', 'city'];
    for (const field of required) {
      if (!data[field] && !data.extracted_metadata?.[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Type validation
    if (data.lot_size_sqft !== undefined && typeof data.lot_size_sqft !== 'number') {
      errors.push('lot_size_sqft must be a number');
    }

    // Pattern validation
    if (data.property_id && !/^[A-Z0-9-]{6,15}$/i.test(data.property_id)) {
      warnings.push('property_id does not match APN format');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Enrich document with parcel database data
   * Uses Nexla's bidirectional connectors
   */
  private async enrichWithParcelData(doc: ScrapedDocument): Promise<any> {
    const enriched: any = { ...doc };
    
    // Extract APN from doc
    const apn = doc.extracted_metadata.apn || 
                doc.extracted_text.match(/(?:APN|Parcel)[\s:]*([A-Z0-9-]{6,15})/i)?.[1];

    if (apn) {
      // In production: Query parcel database via Nexla connector
      // const parcelData = await this.nexlaApi.query({
      //   connection: 'parcel_database',
      //   query: `SELECT * FROM parcels WHERE apn = '${apn}'`
      // });

      // Mock parcel data
      const mockParcelData = {
        property_id: apn,
        address: doc.extracted_metadata.address || '123 Main St',
        city: doc.extracted_metadata.city || 'San Jose',
        current_zoning: doc.extracted_metadata.zoning_code || 'R-1',
        lot_size_sqft: 8200,
        latitude: 37.3382,
        longitude: -121.8863,
        base_density_allowed: 10,
        last_assessed_value: 1200000,
        owner_name: 'John Doe Trust',
      };

      enriched.parcel_data = mockParcelData;
    }

    return enriched;
  }

  /**
   * Apply transformation rules from Nexset definition
   */
  private async applyNexsetTransformations(data: any): Promise<DevelopmentLead> {
    const nexset = this.nexsets.get('development_leads');
    if (!nexset) {
      throw new Error('Development Lead Nexset not found');
    }

    const lead: Partial<DevelopmentLead> = {};
    const rules = nexset.transformation_rules || [];

    for (const rule of rules) {
      let value = null;

      // Extract from source
      if (rule.source) {
        const sourceParts = rule.source.split('.');
        let current = data;
        for (const part of sourceParts) {
          if (current && current[part] !== undefined) {
            current = current[part];
          } else {
            current = null;
            break;
          }
        }
        value = current;
      }

      // Apply transform
      if (value !== null) {
        switch (rule.transform) {
          case 'direct':
            break;
          case 'truncate':
            if (rule.params?.max_length && typeof value === 'string') {
              value = value.substring(0, rule.params.max_length);
            }
            break;
          case 'parse_date':
            if (rule.params?.format === 'iso8601' && typeof value === 'string') {
              value = new Date(value).toISOString();
            }
            break;
          case 'extract_from_text':
            if (rule.params?.pattern && typeof value === 'string') {
              const match = value.match(new RegExp(rule.params.pattern, 'i'));
              value = match ? match[1] : null;
            }
            break;
        }
      }

      // Use fallback if needed
      if (value === null && rule.fallback) {
        const fallbackParts = rule.fallback.split('.');
        let current = data;
        for (const part of fallbackParts) {
          if (current && current[part] !== undefined) {
            current = current[part];
          } else {
            current = null;
            break;
          }
        }
        value = current;
      }

      // Set on lead
      if (value !== null) {
        (lead as any)[rule.field] = value;
      }
    }

    return parseToDevelopmentLead(lead);
  }

  /**
   * Enrich with Helix context
   * Adds semantic metadata, relationships, and documents
   */
  private async enrichWithHelixContext(lead: DevelopmentLead): Promise<DevelopmentLead> {
    // In production: Use Helix to add context
    // const helixContext = await this.helixApi.getContext({
    //   entity: 'parcel',
    //   identifier: lead.property_id,
    //   context_types: ['semantic', 'documents', 'relationships']
    // });

    // Mock Helix enrichment
    const contextEnriched: any = { ...lead };

    // Add semantic context
    contextEnriched['_semantic'] = {
      property_type: 'residential',
      zoning_category: 'single_family',
      transit_access: 'transit_adjacent',
      development_potential: 'high',
    };

    // Add document references
    contextEnriched['_documents'] = [
      { name: 'Zoning Ordinance 2026', relevance: 0.95 },
      { name: 'Specific Plan ECRSP', relevance: 0.88 },
    ];

    // Add relationships
    contextEnriched['_relationships'] = {
      municipality: lead.city,
      zoning_code: lead.current_zoning,
      adjacent_parcels: [],
    };

    return contextEnriched;
  }

  /**
   * Generate MCP tools from Nexsets
   * Uses Nexla's MCP Studio to create governed tools
   */
  public async generateMCPTools(): Promise<MCPToolDefinition[]> {
    console.log('[Nexla] Generating MCP tools from Nexsets...');

    const tools: MCPToolDefinition[] = [];

    for (const [id, nexset] of this.nexsets) {
      tools.push({
        id: `nexset_${id}`,
        name: `query_${nexset.name.toLowerCase().replace(/\s+/g, '_')}`,
        description: `Query the ${nexset.name} data product`,
        input_schema: {
          type: 'object',
          properties: {
            filters: {
              type: 'object',
              description: 'Filter criteria for the query',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 10,
            },
            offset: {
              type: 'number',
              description: 'Pagination offset',
              default: 0,
            },
          },
        },
        output_schema: nexset.schema,
        governance: nexset.governance,
        source: 'nexla_mcp_studio',
        created_at: new Date().toISOString(),
      });
    }

    console.log(`[Nexla] Generated ${tools.length} MCP tools`);
    return tools;
  }

  /**
   * Get current state of the transformer
   */
  public getState(): {
    initialized: boolean;
    connections: string[];
    nexsets: string[];
    helix_enabled: boolean;
  } {
    return {
      initialized: this.isInitialized,
      connections: Array.from(this.connections.keys()),
      nexsets: Array.from(this.nexsets.keys()),
      helix_enabled: true,
    };
  }
}

// --------------------------------------------
// FACTORY FUNCTION
// --------------------------------------------

export function createNexlaTransformer(config?: Partial<NexlaConfig>): NexlaTransformerAgent {
  const defaultConfig: NexlaConfig = {
    api_key: process.env.NEXLA_API_KEY || '',
    api_url: process.env.NEXLA_API_URL || 'https://api.nexla.com/v1',
    municipal_feed_url: process.env.MUNICIPAL_FEED_URL || 'https://api.rtrvr.ai/scrape',
    parcel_database_url: process.env.DATABASE_URL || 'postgres://localhost:5432/parcel_db',
    helix_enabled: true,
    mcp_gateway_enabled: true,
    agentic_probe_enabled: true,
    data_product_prefix: 'zoning_',
    governance_policy: 'enterprise',
    retention_days: 365,
  };

  return new NexlaTransformerAgent({
    ...defaultConfig,
    ...config,
  });
}

export default NexlaTransformerAgent;