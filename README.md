# Object Storage

Simulates a cloud object storage service (such as AWS Simple Storage Service - S3) with buckets, storage classes, and cost estimation.

## Overview

The Object Storage service simulates distributed blob storage architectures used to persist unstructured files and assets. It demonstrates bucket creation with DNS-compliant naming validation, multi-tier storage classes (Standard and Infrequent Access), binary file persistence, and direct object downloads. Real-time cost estimators calculate projected monthly bills based on data volume per tier.

## Features

- Bucket lifecycle management enforcing DNS-compatible naming rules (3-30 lowercase characters, numbers, and hyphens)
- Multi-tier storage classes supporting Standard ($0.023/GB) and Infrequent Access ($0.0125/GB)
- Base64 binary file ingestion supporting payloads up to 2MB with automatic MIME detection
- Object retrieval with attachment streaming and accurate `Content-Disposition` download headers
- Binary persistence backed by PostgreSQL `BYTEA` storage
- Aggregated bucket metrics tracking object count, total capacity, and storage tier breakdown
- Live monthly storage cost projection computed dynamically per bucket
- Safe deletion guards preventing accidental removal of non-empty buckets without explicit force confirmation

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Backend | Node.js + Express |
| Database | PostgreSQL 16 |
| Auth | JWT |
| Container | Docker Compose |

## Project Structure

```
object-storage/
├── backend/
├── database/
│   └── init.sql
├── docker-compose.yml
└── frontend/
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Option A: Docker Compose

1. From the `object-storage` directory, run:
   ```bash
   docker compose up --build
   ```
2. Access the applications:
   - Frontend: http://localhost:3001
   - Backend: http://localhost:4001

### Option B: Local Development

1. Start the PostgreSQL database:
   ```bash
   docker compose up -d db
   ```
2. Start the backend service:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Backend runs on http://localhost:4001.
3. Start the frontend application:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Frontend runs on http://localhost:3001.

> `database/init.sql` runs only on first container startup. To reset the database and re-run initialization, run `docker compose down -v`.

## Demo Login

- **Email**: admin@demo.com
- **Password**: demo123

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
| --- | --- |
| `PORT` | Port for Express backend server (default: 4001) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key used to sign and verify authentication JWT tokens |
| `CORS_ORIGIN` | Allowed origin for Cross-Origin Resource Sharing |

### Frontend (`frontend/.env.local`)

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL for the backend API (default: http://localhost:4001) |

*Note: The frontend reads the API URL from `NEXT_PUBLIC_API_URL` at build time, so it must be configured before building for deployment.*

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Server health check endpoint |
| POST | `/api/auth/login` | Authenticate administrator and receive JWT token |
| GET | `/api/buckets` | List all buckets with capacity metrics and estimated monthly costs |
| POST | `/api/buckets` | Create a new bucket with unique naming validation |
| DELETE | `/api/buckets/:id` | Delete a bucket (requires `force=true` query param if non-empty) |
| GET | `/api/buckets/:id/objects` | List all objects stored within a specific bucket |
| POST | `/api/buckets/:id/objects` | Upload a new object as base64 data (up to 2MB) |
| GET | `/api/buckets/:bucketId/objects/:objectId` | Download an object file directly |
| DELETE | `/api/buckets/:bucketId/objects/:objectId` | Permanently remove an object |

## Notes

- Object binary payloads are stored directly in PostgreSQL as `BYTEA` fields with a maximum size limit of 2MB per file.

## License

MIT
