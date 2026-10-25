# Invoke AI via Curl

## Setup Api Key

- https://platform.deepseek.com/usage
- https://api-docs.deepseek.com/

```
# export DEEPSEEK_API_KEY="sk-..."
echo $DEEPSEEK_API_KEY
```

## Once

- Client -> AI
- AI -> Client

```shell
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
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

- Client -> AI
- AI -> Client (with tool info)

```shell
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
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
        "reasoning_content": "The user asks about Hangzhou weather today. I should call get_weather.",
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

---

- Client execute tool

```shell
TOOL_CALL_ID='call_00_IfnJnR2LzDdPvmgiX8Hs6447'
ARGS='{"city": "杭州"}'

CITY=$(echo "$ARGS" | jq -r '.city')
case "$CITY" in
  杭州) TOOL_RESULT='杭州今天多云，气温 22°C，东南风 3 级' ;;
  *)    TOOL_RESULT="暂无 $CITY 的天气数据" ;;
esac

echo "get_weather($CITY) => $TOOL_RESULT"
echo "tool_call_id       => $TOOL_CALL_ID"
```

```
get_weather(杭州) => 杭州今天多云，气温 22°C，东南风 3 级
tool_call_id       => call_00_IfnJnR2LzDdPvmgiX8Hs6447
```

---

- Client -> AI (with tool reasult)
- AI -> Client

```shell
curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-flash",
    "messages": [
      {"role": "user", "content": "杭州今天天气怎么样？"},
      {
        "role": "assistant",
        "reasoning_content": "The user asks about Hangzhou weather today. I should call get_weather.",
        "content": "I'\''ll check the weather in Hangzhou for you.",
        "tool_calls": [
          {
            "id": "call_00_IfnJnR2LzDdPvmgiX8Hs6447",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\": \"杭州\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "call_00_IfnJnR2LzDdPvmgiX8Hs6447",
        "content": "杭州今天多云，气温 22°C，东南风 3 级"
      }
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
    "stream": false
  }'
```

```json
{
  "id": "c27cb306-3794-4d64-84f5-59ddcf97850e",
  "object": "chat.completion",
  "created": 1792908336,
  "model": "deepseek-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "杭州今天天气情况如下：\n\n- **天气**：多云\n- **气温**：22°C\n- **风力**：东南风 3 级\n\n整体来说是比较舒适的一天，气温适中、风力不大，适合外出活动。不过多云天气紫外线仍可能存在，外出可以适当防晒；早晚温差可能需要备一件薄外套。",
        "reasoning_content": ""
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 397,
    "completion_tokens": 71,
    "total_tokens": 468,
    "prompt_tokens_details": { "cached_tokens": 256 },
    "completion_tokens_details": { "reasoning_tokens": 0 },
    "prompt_cache_hit_tokens": 256,
    "prompt_cache_miss_tokens": 141
  },
  "system_fingerprint": "e72d3c7f663d3e1383b00b3884cb4501"
}
```
