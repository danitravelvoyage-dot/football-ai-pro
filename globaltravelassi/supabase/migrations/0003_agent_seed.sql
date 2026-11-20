-- =====================================================================
-- 0003 — Agent rows (additive). DO NOT RUN until the owner approves.
-- ai_tasks.agent references ai_agents(key). Without these rows, starting a workflow fails.
-- Only inserts missing rows; existing rows are left unchanged.
-- =====================================================================

insert into public.ai_agents (key, name, prompt_version) values
  ('COOAgent', 'AI Chief Operating Officer', '1.0.0'),
  ('MarketResearchAgent', 'Market Research Agent', '1.0.0'),
  ('MarketingStrategistAgent', 'Marketing Strategist', '1.0.0'),
  ('ContentCreatorAgent', 'Content Creator', '1.0.0'),
  ('CreativeDirectorAgent', 'Creative Director', '1.0.0'),
  ('VideoProductionAgent', 'Video Production', '1.0.0'),
  ('SocialMediaAgent', 'Social Media Manager', '1.0.0'),
  ('SEOAgent', 'SEO Agent', '1.0.0'),
  ('SalesAgent', 'Sales Agent', '1.0.0'),
  ('CustomerSupportAgent', 'Customer Support Agent', '1.0.0'),
  ('CRMAgent', 'CRM Agent', '1.0.0'),
  ('VisaResearchAgent', 'Visa Research Agent', '1.0.0'),
  ('DataAnalystAgent', 'Data Analyst Agent', '1.0.0'),
  ('FinanceAgent', 'Finance Agent', '1.0.0'),
  ('ComplianceAgent', 'Quality and Compliance Agent', '1.0.0'),
  ('WebsiteOperationsAgent', 'Website Operations Agent', '1.0.0')
on conflict (key) do nothing;
