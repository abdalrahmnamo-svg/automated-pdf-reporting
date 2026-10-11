-- KPI layer for --source warehouse.
--
-- Every KPI is computed here, from the support-analytics-warehouse marts, using the definitions in
-- that repo's docs/metrics.md. The JS layer (src/kpi/warehouse.js) only binds the two parameters,
-- converts types and formats. Nothing is re-derived in JavaScript.
--
-- Parameters (both naive UTC timestamps, period is half-open [start, end)):
--   $period_start, $period_end
--
-- Result: one row per (level, key)
--   level = 'team'  key = 'all'        whole period
--   level = 'agent' key = agent_name   assigned tickets only (unanswered tickets are unassigned)
--   level = 'month' key = 'YYYY-MM'    calendar months inside the period
--
-- Which date each measure is attributed to follows marts.fct_agent_daily: a ticket by created_at,
-- a CSAT answer by submitted_at, a QA score by scored_at.
--
-- Output units: FRT in minutes, rates as percentages (0-100), unrounded. A KPI with no underlying
-- rows is NULL, never 0.

with
tix as (
    select
        a.agent_name,
        strftime(t.created_at, '%Y-%m')  as month,
        t.first_response_minutes,
        t.is_resolved,
        t.is_frt_sla_breached
    from marts.fct_tickets t
    left join marts.dim_agent a using (agent_key)
    where t.created_at >= cast($period_start as timestamp)
      and t.created_at <  cast($period_end   as timestamp)
),

tix_kpi as (
    select
        case when grouping(agent_name) = 0 then 'agent'
             when grouping(month)      = 0 then 'month'
             else 'team' end                                          as level,
        coalesce(agent_name, month, 'all')                            as key,
        count(*)                                                      as tickets,
        count(first_response_minutes)                                 as answered,
        -- FRT p50 / p90: quantile_cont over answered tickets (metrics.md "FRT p50 / p90")
        quantile_cont(first_response_minutes, 0.5)                    as frt_p50_minutes,
        quantile_cont(first_response_minutes, 0.9)                    as frt_p90_minutes,
        -- Resolution rate: resolved tickets / all tickets in the group (metrics.md "Resolution rate")
        count(*) filter (where is_resolved)                           as resolved,
        100.0 * avg(is_resolved::int)                                 as resolution_rate_pct,
        -- First-response SLA breach: unanswered tickets are breaches (metrics.md "First-response SLA breach")
        count(*) filter (where is_frt_sla_breached)                   as sla_breached,
        100.0 * avg(is_frt_sla_breached::int)                         as sla_breach_pct
    from tix
    group by grouping sets ((), (agent_name), (month))
    -- tickets nobody was assigned to have no agent row; they stay in the team and month totals
    having not (grouping(agent_name) = 0 and agent_name is null)
),

survey as (
    select
        a.agent_name,
        strftime(c.submitted_at, '%Y-%m') as month,
        c.rating,
        c.is_satisfied
    from marts.fct_csat c            -- valid ratings (1-5) only; 0 and 6 never reach the mart
    left join marts.dim_agent a using (agent_key)
    where c.submitted_at >= cast($period_start as timestamp)
      and c.submitted_at <  cast($period_end   as timestamp)
),

csat_kpi as (
    select
        case when grouping(agent_name) = 0 then 'agent'
             when grouping(month)      = 0 then 'month'
             else 'team' end                                          as level,
        coalesce(agent_name, month, 'all')                            as key,
        count(*)                                                      as csat_responses,
        count(*) filter (where is_satisfied)                          as csat_satisfied,
        -- CSAT: share of valid answers that are 4 or 5 (metrics.md "CSAT")
        100.0 * avg(is_satisfied::int)                                as csat_pct,
        avg(rating)                                                   as avg_rating
    from survey
    group by grouping sets ((), (agent_name), (month))
    having not (grouping(agent_name) = 0 and agent_name is null)
),

reviews as (
    select
        a.agent_name,
        strftime(q.scored_at, '%Y-%m') as month,
        q.is_passed
    from marts.fct_qa_scores q       -- valid totals only; pass mark 90 is applied upstream
    left join marts.dim_agent a using (agent_key)
    where q.scored_at >= cast($period_start as timestamp)
      and q.scored_at <  cast($period_end   as timestamp)
),

qa_kpi as (
    select
        case when grouping(agent_name) = 0 then 'agent'
             when grouping(month)      = 0 then 'month'
             else 'team' end                                          as level,
        coalesce(agent_name, month, 'all')                            as key,
        count(*)                                                      as qa_scores,
        count(*) filter (where is_passed)                             as qa_passed,
        -- QA pass rate: passed scores / all valid scores (metrics.md "QA pass rate")
        100.0 * avg(is_passed::int)                                   as qa_pass_rate_pct
    from reviews
    group by grouping sets ((), (agent_name), (month))
    having not (grouping(agent_name) = 0 and agent_name is null)
)

select
    level,
    key,
    coalesce(tickets, 0)          as tickets,
    coalesce(answered, 0)         as answered,
    frt_p50_minutes,
    frt_p90_minutes,
    coalesce(resolved, 0)         as resolved,
    resolution_rate_pct,
    coalesce(sla_breached, 0)     as sla_breached,
    sla_breach_pct,
    coalesce(csat_responses, 0)   as csat_responses,
    coalesce(csat_satisfied, 0)   as csat_satisfied,
    csat_pct,
    avg_rating,
    coalesce(qa_scores, 0)        as qa_scores,
    coalesce(qa_passed, 0)        as qa_passed,
    qa_pass_rate_pct
from tix_kpi
full join csat_kpi using (level, key)
full join qa_kpi   using (level, key)
order by level, key
