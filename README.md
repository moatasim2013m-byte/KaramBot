# KaramBot config split

This repository now keeps the conversational engine generic and stores tenant business logic in tenant config files.

## Structure

- `engine/`: reusable runtime and config loading code
- `tenants/karambot/config/`: KaramBot tenant-specific prompt/business/contact/FAQ/intent/escalation/booking content
- `tenants/peekaboo/config/`: untouched source tenant content copied for migration parity
