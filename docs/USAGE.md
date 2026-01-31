# Usage Guide

## Web Interface

Once the application is running (see [GETTING_STARTED.md](./GETTING_STARTED.md)), navigate to `http://localhost:3000`.

### Key Features

*   **Dashboard:** Overview of recent interactions and upcoming reminders (birthdays, follow-ups).
*   **Contacts:** Browse and search your network. Click a contact to view their timeline, extracted facts, and notes.
*   **Search:** Use natural language to find information (e.g., "Who did I talk to about hiking last month?").
*   **Graph:** Visualize connections between people and topics.

## The Sync Daemon

The core value of PKB comes from the data it ingests. The **Daemon** is responsible for this.

### Configuration (`daemon/config.yaml`)
Create a `config.yaml` file in the `daemon` directory:

```yaml
api_url: "http://localhost:4000/api"
api_key: "your-secure-api-key-for-daemon" # Must match backend API_KEY
sync_interval: 60 # Seconds
sources:
  imessage:
    enabled: true
    db_path: "/Users/yourname/Library/Messages/chat.db"
  calendar:
    enabled: true
```

### Running the Daemon
```bash
cd daemon
go run cmd/daemon/main.go
```

The daemon will:
1.  Scan configured sources for new data.
2.  Batch upload to the backend.
3.  Log progress to the console.

## AI Features

*   **Fact Extraction:** When new conversations are synced, the system automatically analyzes them to extract facts (e.g., interests, relationships).
*   **Smart Search:** Your queries are embedded and compared against stored data to find semantically relevant results, not just keyword matches.
