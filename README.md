How It Works
Step One: Ingestion
First, an AI web-scraping agent constantly watches Santa Clara County planning portals, building permit databases, and city council agendas. It flags any document that mentions keywords like "density bonus," "zoning amendment," or "specific plan."

Step Two: Reasoning
Then, the MiniMax M3 model steps in. With a one-million token context window, it reads the entire municipal zoning code — hundreds of pages of dense legal text — and cross-references it against the property data.

For each property, it calculates two things:

A Density-Add Score that tells you how much development potential has just been unlocked.

An Exclusionary Index that measures how resistant the neighborhood is to multi-family housing.

Step Three: Pricing & Deal Scoring
Next, a pricing engine — trained on real pending sales across Santa Clara County — estimates the property's actual market value. Then it compares that estimate to the listing price to produce a single number: the Deal Score.

If the Deal Score is below 0.85, the system flags it as a Strong Buy.

Step Four: Action & Collaboration
Finally, when the system finds a high-conviction lead, it automatically generates two documents:

A formal inquiry letter to the city planning department, citing the specific legal provisions that allow for density increases.

A persuasive owner-outreach letter proposing a joint venture or acquisition.

Both documents are routed through Band — a collaboration layer — to a human analyst. If the analyst approves, the system can even generate a TCPA-compliant voicemail script using ElevenLabs, ready for automated outreach.

The Results
In our test run, the system processed 36 pending properties across 10 cities. Its pricing model achieved an R² of 0.945 — meaning it explains 94.5% of the price variance. It found seven properties that were significantly undervalued, with an average estimated upside of over $400,000 per property.
