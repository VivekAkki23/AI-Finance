# AWS IAM Security Architecture — AI Finance Project

This document describes the complete AWS Identity and Access Management (IAM) security architecture implemented for the AI Finance application.

---

## Project Overview

**Application:** AI Finance — an AI-powered personal finance tracker  
**Tech Stack:** Node.js, Express, SQLite, Docker, GitHub Actions CI/CD  
**AWS Account:** AI Finance (132831331421)  
**Region:** Asia Pacific — Mumbai (ap-south-1)

---

## Architecture Diagram

```
AI Finance Application
│
├── GitHub Repository
│   ├── server.js (Node.js backend)
│   ├── Dockerfile
│   └── .github/workflows/ (CI/CD Pipeline)
│
└── AWS Infrastructure
    ├── IAM Users & Groups
    │   ├── finance-admin       → FinanceAdmins     → AdministratorAccess
    │   ├── finance-developer   → FinanceDevelopers → EC2 + S3 ReadOnly + AIFinanceAppPolicy
    │   ├── finance-viewer      → FinanceViewers    → ReadOnlyAccess
    │   └── finance-intern      → FinanceViewers    → ReadOnlyAccess (inherited)
    │
    ├── IAM Role
    │   └── AIFinanceEC2Role → attached to EC2 → allows S3 access without hardcoded keys
    │
    ├── Custom Policy
    │   └── AIFinanceAppPolicy → s3:GetObject, s3:PutObject on ai-finance-bucket-vivek only
    │
    ├── S3 Bucket
    │   └── ai-finance-bucket-vivek
    │       ├── finance-admin    → GetObject, PutObject, DeleteObject (full access)
    │       └── finance-developer → GetObject only (read-only)
    │
    └── CloudTrail
        └── AIFinanceAuditTrail → logs all IAM + S3 actions across all regions
```

---

## Topic 1 — Role-Based Access Control System

### What was implemented
Created 3 IAM users representing different roles in the AI Finance project team.

| IAM User | Role | Group |
|---|---|---|
| finance-admin | AWS infrastructure manager | FinanceAdmins |
| finance-developer | Developer deploying via CI/CD | FinanceDevelopers |
| finance-viewer | Monitoring and read-only access | FinanceViewers |

### How it links to AI Finance
The AI Finance app has different team members with different responsibilities. IAM users map directly to these real-world roles — an admin manages AWS resources, a developer deploys new features, a viewer monitors the running app.

---

## Topic 2 — Developer vs Admin Permissions

### What was implemented
Each group has different permission levels:

| Group | Policies Attached | Access Level |
|---|---|---|
| FinanceAdmins | AdministratorAccess | Full AWS access |
| FinanceDevelopers | AmazonEC2ReadOnlyAccess, AmazonS3ReadOnlyAccess, AIFinanceAppPolicy | Limited deployment access |
| FinanceViewers | ReadOnlyAccess | View-only access |

### How it links to AI Finance
The GitHub Actions CI/CD pipeline that builds and deploys the AI Finance Docker container runs with `finance-developer` credentials — it can deploy but cannot delete production databases or modify IAM settings.

---

## Topic 3 — Least Privilege Access Architecture

### What was implemented
Created a custom IAM policy `AIFinanceAppPolicy` that grants only the minimum permissions needed:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::ai-finance-bucket-vivek/*"
    }
  ]
}
```

### How it links to AI Finance
The `server.js` backend reads and writes financial data files (exports, reports). This policy ensures the app can only read and upload files to its specific bucket — it cannot delete financial records or access any other AWS service.

---

## Topic 4 — Secure EC2 Access via IAM Roles

### What was implemented
Created `AIFinanceEC2Role` — an IAM role for EC2 instances with `AIFinanceAppPolicy` attached.

- **Trusted entity:** AWS EC2 service
- **Policy attached:** AIFinanceAppPolicy
- **Purpose:** Allows the AI Finance server to access S3 without storing AWS credentials in code

### How it links to AI Finance
The AI Finance repo previously had a `.env` file with credentials committed publicly — a major security risk. By attaching `AIFinanceEC2Role` to the EC2 instance running the Docker container, `server.js` gets automatic S3 access with zero hardcoded credentials.

**Before (insecure):**
```
AWS_ACCESS_KEY=AKIA... (stored in .env file on GitHub)
```

**After (secure):**
```
EC2 instance → IAM Role → automatic S3 access (no keys needed)
```

---

## Topic 5 — S3 Bucket Access Control System

### What was implemented
Created S3 bucket `ai-finance-bucket-vivek` with role-based bucket policy:

| User | Allowed Actions |
|---|---|
| finance-admin | GetObject, PutObject, DeleteObject |
| finance-developer | GetObject only |
| Everyone else | Denied |

### How it links to AI Finance
The AI Finance application generates financial reports and data exports. These are stored in S3. The bucket policy ensures:
- Admins can manage all financial files
- Developers can read files for debugging but cannot delete production financial data
- No public access to sensitive financial information

---

## Topic 6 — IAM Group Hierarchy

### What was implemented
Demonstrated group-based permission inheritance:

```
FinanceViewers group (ReadOnlyAccess)
└── finance-viewer  (existing member)
└── finance-intern  (new member — inherited ReadOnlyAccess automatically)
```

### How it links to AI Finance
When a new intern joins the AI Finance project team, they are simply added to `FinanceViewers` — they automatically get read-only access to monitor the application without any individual permission configuration needed.

---

## Topic 7 — IAM Policy Testing Lab

### What was implemented
Used AWS IAM Policy Simulator to verify policies work correctly for `finance-developer`:

| Action | Result | Reason |
|---|---|---|
| S3:GetObject | ✅ Allowed | AmazonS3ReadOnlyAccess grants read |
| S3:DeleteObject | ❌ Denied | No delete permission in any attached policy |

### How it links to AI Finance
Before deploying the CI/CD pipeline to production, we verified that the developer role cannot accidentally delete financial data — even if a misconfigured pipeline runs a delete command.

---

## Topic 8 — Access Audit Architecture

### What was implemented
Created `AIFinanceAuditTrail` CloudTrail trail:

- **Trail name:** AIFinanceAuditTrail
- **Coverage:** Multi-region (all AWS regions)
- **Events logged:** All management events (read + write)
- **Storage:** S3 bucket (aws-cloudtrail-logs-132831331421)
- **Status:** Active — Logging

### How it links to AI Finance
Every action in the AI Finance AWS infrastructure is now logged:
- Every CI/CD deployment by the pipeline
- Every S3 file access (financial reports read/written)
- Every IAM change (new user added, policy changed)
- Every login attempt by any IAM user

This audit trail is essential for a **finance application** — financial apps require complete audit logs for compliance and security monitoring.

---

## Security Improvements Made

| Issue | Before | After |
|---|---|---|
| Credentials in code | `.env` file with keys on GitHub | IAM Role on EC2 — no keys needed |
| Access control | No AWS access control | Role-based IAM with least privilege |
| File storage security | No bucket policy | Bucket policy with per-user permissions |
| Audit logging | No logging | CloudTrail logging all actions |
| Team access | No structure | Group-based hierarchy |

---

## CI/CD Pipeline Integration

The GitHub Actions pipeline connects to AWS as `finance-developer`:

```
Code Push → GitHub Actions → Docker Build → DockerHub
                                               ↓
                                          EC2 Instance (AIFinanceEC2Role attached)
                                               ↓
                                          Docker Pull + Run
                                               ↓
                                          App accesses S3 via IAM Role (no keys)
                                               ↓
                                          CloudTrail logs the deployment
```

---

## Summary

This AWS IAM architecture secures the AI Finance application by implementing:
1. Role-based access control with 4 users across 3 groups
2. Least privilege permissions — each role gets only what it needs
3. Secure EC2 deployment via IAM roles — no hardcoded credentials
4. S3 bucket protection with per-user access control
5. Complete audit logging via CloudTrail for compliance

*Implemented as part of Cloud Computing Project 3 — IAM Security Architecture*
