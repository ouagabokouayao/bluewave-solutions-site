SELECT day, event_name, page, journey, offer, status, source, campaign, SUM(count) AS events
FROM conversion_counts GROUP BY day,event_name,page,journey,offer,status,source,campaign
ORDER BY day DESC,event_name,page;
