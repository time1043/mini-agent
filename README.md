# Invoke AI via Curl

## Setup Api Key

- https://platform.deepseek.com/usage
- https://api-docs.deepseek.com/

```
# export DEEPSEEK_KEY="sk-..."
echo $DEEPSEEK_KEY
```

## Once

```shell
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"hi"}],"stream":false}'
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
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
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

## Once but with Tool

```shell
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-flash",
    "messages": [
      {"role": "user", "content": "杭州今天天气怎么样？"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "获取指定城市的天气信息",
          "parameters": {
            "type": "object",
            "properties": {
              "city": {"type": "string", "description": "城市名称，例如：杭州"}
            },
            "required": ["city"]
          }
        }
      }
    ],
    "tool_choice": "auto",
    "stream": false
  }'
```

```json
{
  "id": "4a45720b-f191-46d7-8301-5b84c1a62de2",
  "object": "chat.completion",
  "created": 1792903113,
  "model": "deepseek-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'll check the weather in Hangzhou for you.",
        "tool_calls": [
          {
            "index": 0,
            "id": "call_00_IfnJnR2LzDdPvmgiX8Hs6447",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\": \"杭州\"}"
            }
          }
        ]
      },
      "logprobs": null,
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 280,
    "completion_tokens": 48,
    "total_tokens": 328,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 280
  },
  "system_fingerprint": "e72d3c7f663d3e1383b00b3884cb4501"
}
```
