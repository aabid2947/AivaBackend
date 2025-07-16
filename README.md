# Aiva Backend - README

## 📌 Overview

The **Aiva Backend** powers the AI virtual assistant functionality for the Aiva mobile app. It is built with **Node.js** and designed to interact with users intelligently through natural language, summarization, reminders, and email-based interactions.

This backend acts as an **AI agent** using the **Gemini model**, deployed on a **DigitalOcean VPS**, and provides secure API endpoints for chat interaction, content summarization, reminder scheduling, and smart email replies.

---

## 🧠 Core Capabilities

### 🤖 AI-Powered Chat Agent

* Integrates with **Gemini** to engage in natural human conversations
* Used by the mobile client (React Native app) to simulate intelligent dialogue

### 📩 Email Monitoring & Smart Reply

* Monitors a designated email inbox
* Uses Gemini AI to **analyze incoming emails** and **automatically generate context-aware replies**

### 📝 Summarization Services

* **Text Summarization**: Compress long user input into concise summaries
* **File Summarization**: Handles uploaded `.txt`, `.pdf`, `.jpeg`, `.png` files
* **Image Summarization**: Converts image content (OCR or direct description) into textual summaries

### ⏰ Smart Reminders

* Schedule reminders via chat
* Stores reminders in the database with cron-job-based execution (or background task processor)

---

## ⚙️ Tech Stack

* **Node.js + Express** (REST API)
* **MongoDB** (Mongoose for data modeling)
* **JWT** for secure API auth
* **Firebase Admin SDK** (for auth & push notifications)
* **Multer** for file uploads
* **Gemini (LLM API)** integration for AI tasks

---

## 📁 Folder Structure

```
aiva-backend/
├── controllers/       # Handle route logic
├── routes/            # API route definitions
├── services/          # Business logic: AI, email, reminders, summarization
├── middleware/        # Auth, error handlers
├── models/            # MongoDB schemas (Chat, User, Reminder, etc)
├── utils/             # Helper functions
└── server.js          # Entry point
```

---

## 🔐 Environment Variables (`.env`)

```
PORT=5000
MONGO_URI=your-mongodb-uri
JWT_SECRET=your-secret
EMAIL_USER=youremail@example.com
EMAIL_PASS=your-email-password-or-app-password
GEMINI_API_KEY=your-gemini-api-key
```

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Run the server

```bash
npm run dev  # for development
```

### 3. Test API endpoints

Use tools like **Postman** or **Insomnia** to test endpoints like:

* `POST /api/chat/interact`
* `POST /api/summarize/text`
* `POST /api/summarize/file`
* `POST /api/reminder`
* `GET /api/email/monitor`

---

## 🌐 Deployment

* Hosted on a **DigitalOcean** droplet (Ubuntu server)
* PM2 used for process management
* Nginx used as a reverse proxy

---



---

## 🤝 Contributions

This is a closed-source project for now. For collaboration or inquiries, contact the author below.

---

## 👤 Author

**Md Aabid Hussain**
GitHub: [github.com/aabidhussain](https://github.com/aabidhussain)

---
