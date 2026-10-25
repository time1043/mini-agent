```
# echo $DEEPSEEK_KEY
# export DEEPSEEK_KEY="sk-..."
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

```json
{
  "id": "33b009cc-963c-4021-a83b-f1e26a0dc21e",
  "object": "chat.completion",
  "created": 1792902180,
  "model": "deepseek-flash",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help you today?" },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 5,
    "completion_tokens": 9,
    "total_tokens": 14,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 5
  },
  "system_fingerprint": "e72d3c7f663d3e1383b00b3884cb4501"
}
```
