-- Ticket volume per bucket for the trend chart (--source warehouse).
-- Volume = tickets created in the bucket (metrics.md: tickets are attributed to created_at).
-- $bucket_days is 1 for short ranges, 7 otherwise; bucket 0 starts at $period_start.
select
    cast(date_diff('day', cast($period_start as timestamp), t.created_at) // $bucket_days as integer) as bucket,
    count(*) as volume
from marts.fct_tickets t
where t.created_at >= cast($period_start as timestamp)
  and t.created_at <  cast($period_end   as timestamp)
group by 1
order by 1
