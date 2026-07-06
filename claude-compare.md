# Claude Pro vs API + TPT Cost Comparison

*Last updated: 2026-06-22*

## Assumptions

- Average Claude Code exchange: ~15,000 input tokens, ~1,500 output tokens
- Primary model: Claude Sonnet 4.6 ($3/MTok in, $15/MTok out)
- Claude Haiku 4.5: $1/MTok in, $5/MTok out (Router fallback)
- Claude Pro: ~$20/month flat rate (rate-limited, Sonnet access)

## Results

| Scenario | Cost/request | Requests for $20/mo |
|---|---|---|
| Raw Sonnet 4.6 API (no TPT) | $0.0675 | ~296 |
| API + TPT (caching + AST compression) | $0.054 | ~370 (+25%) |
| API + TPT + Router (20% routed to Haiku) | $0.047 | ~427 (+44%) |
| Claude Pro subscription | $20 flat | Rate-limited |

## Per-Request Breakdown

**No TPT:**
```
(15,000 × $3 + 1,500 × $15) / 1,000,000 = $0.0675
```

**With TPT (~30% input reduction via Token Shield + Smart Context + Memory Weaver):**
```
(10,500 × $3 + 1,500 × $15) / 1,000,000 = $0.054
```

**With TPT + Router (20% to Haiku):**
```
80% × $0.054 + 20% × [(10,500 × $1 + 1,500 × $5) / 1M]
= $0.0432 + 0.20 × $0.018
= $0.047
```

## Claude Pro Token Estimate

Anthropic doesn't publish exact token limits — rate limits are dynamic by model and server load.

**Observed rate limits (community data):**
- Sonnet: ~45–100 messages per 5-hour rolling window
- Opus: ~20–45 messages per 5-hour window
- Heavy Claude Code users report hitting Sonnet limits at ~50–80 messages per active session

**Power-user estimate (80 messages/day, 20 workdays):**
```
80 messages × 16,500 tokens × 20 days = ~26M tokens/month
80 messages × $0.068/msg × 20 days   = ~$109/month API-equivalent
```

At that usage level, Pro at $20/month is effectively **~5–6x leveraged** vs API pricing. Most users don't max limits every day, so actual leverage varies — but heavy coders hitting limits mid-session are getting $100+ of API value for $20.

## Key Findings

- TPT optimizations stretch the same budget ~25–44% further vs raw API
- API gives unlimited requests; Pro has rate limits (hard-caps mid-session)
- The crossover where API becomes better value is around ~300+ requests/month
- **TPT requires pay-per-token billing to show cost savings** — Claude Pro uses OAuth (no per-token billing), so TPT proxy savings don't reduce actual spend on a Pro subscription

## Conclusion

Claude Pro still provides better value when:
- Usage is moderate (under ~300 requests/month)
- You use claude.ai web interface / Projects in addition to Claude Code
- You don't want to manage API keys and billing

API + TPT is better when:
- You're hitting Pro rate limits regularly
- You want unlimited throughput
- You're willing to manage API key billing (OpenRouter or Anthropic API)
