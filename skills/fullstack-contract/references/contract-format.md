---
name: contract-format
description: The JSON format of the persisted API contract and the field type grammar the verifiers understand.
type: contract
---

# Contract format

File: `.dev-agent/tasks/<KEY>.contract.json` (next to the task ledger). One file describes one endpoint.

    {
      "method": "POST",
      "path": "/api/users",
      "request":  { "email": "email", "name": "string", "nickname": "string?" },
      "response": { "id": "uuid", "email": "email", "name": "string", "tags": "string[]",
                    "profile": { "age": "integer", "bio": "string?" } },
      "errors":   { "400": ["INVALID_INPUT"], "409": ["EMAIL_ALREADY_EXISTS"] },
      "successStatus": 201
    }

## Fields

- `method`: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`, uppercase.
- `path`: absolute, no query string, no `..` or `//`; path parameters as `{id}`.
- `request`: body fields (omit for no body). `response`: body fields (`{}` for an empty body). Required.
- `errors`: each 4xx/5xx status maps to a non-empty list of error codes in UPPER_SNAKE_CASE. Required (`{}` for none).
- `successStatus`: optional integer 200 to 299. When absent any 2xx passes.

## Types

`string`, `uuid`, `email`, `integer`, `number`, `boolean`, `datetime` (ISO 8601), `date` (`YYYY-MM-DD`), `object`, `any`.

- Suffix `?` makes a field optional (and lets it be `null`): `string?`.
- Suffix `[]` makes an array of that type: `string[]`, `string[]?`.
- A one-element array is an array of that type, including objects: `["uuid"]`, `[{ "id": "uuid" }]`.
- A key may end in `?` to make any field optional, including nested objects and arrays: `"profile?": { "age": "integer" }`, `"items?": [{ "id": "uuid" }]`. `a` and `a?` may not both appear.
- `request` and `response` may themselves be a one-element array when the body is an array: `"response": [{ "id": "uuid", "email": "email" }]`.
- An object value nests fields, up to four levels (arrays count as a level) and 100 fields per object.
- Field names: letters, digits and `_`, starting with a letter or `_`.

## Error bodies

The verifiers read the error code from `code`, `error.code` or `detail.code` of the response body.
