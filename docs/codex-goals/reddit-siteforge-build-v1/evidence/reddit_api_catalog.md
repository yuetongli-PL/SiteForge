# Reddit Official API Catalog

Operations: 202
OAuth endpoint templates: 260
GET templates: 78
Site action read runtime templates: 78
Runtime-ready api_request plans: 78
Write templates disabled: 124

Method counts:
- DELETE: 7
- GET: 78
- PATCH: 3
- POST: 109
- PUT: 5

Top OAuth scopes:
- read: 44
- modmail: 19
- modposts: 18
- structuredstyles: 10
- modflair: 10
- subscribe: 10
- livemanage: 10
- modconfig: 10
- flair: 7
- any: 6
- privatemessages: 6
- edit: 5
- report: 5
- submit: 5
- modwiki: 5
- wikiread: 5
- announcements: 4
- save: 4
- modnote: 4
- identity: 3

Execution boundary:
- GET operations require an operator-supplied Reddit OAuth bearer token and descriptive User-Agent.
- Non-GET operations are recorded as disabled templates and are not auto-executed.
