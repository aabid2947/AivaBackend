# User Data Export System

## Overview
This system automatically exports all data for user `RC0HRMUeGQVQtAzB3rMzukxnLb62` when the server starts and provides manual export capabilities.

## Automatic Export on Server Startup

When you start the server with `npm start`, it will automatically:

1. ✅ Fetch all documents for user `RC0HRMUeGQVQtAzB3rMzukxnLb62`
2. ✅ Search across all Firebase collections and subcollections
3. ✅ Save the data to `exports/user_RC0HRMUeGQVQtAzB3rMzukxnLb62_startup_export.json`
4. ✅ Display a summary in the console logs

### Console Output Example
```
[INFO] 🚀 Starting user data export...
[INFO] Fetching all data for user: RC0HRMUeGQVQtAzB3rMzukxnLb62
[INFO] Fetching user profile...
[INFO] ✅ Found user profile
[INFO] Checking collection: appointments
[INFO] ✅ Found 5 documents in collection group appointments
[INFO] ✅ Total documents found for user RC0HRMUeGQVQtAzB3rMzukxnLb62: 15
[INFO] ✅ User data saved to: C:\...\exports\user_RC0HRMUeGQVQtAzB3rMzukxnLb62_startup_export.json
[INFO] 🎉 Startup user data export completed
```

## Manual Export via API

You can also export user data manually using these API endpoints:

### 1. Export Target User Data
```
GET http://localhost:5000/api/userdata/export-target
```

**Response:**
```json
{
  "success": true,
  "message": "Target user data exported successfully",
  "userId": "RC0HRMUeGQVQtAzB3rMzukxnLb62",
  "filePath": "C:\\...\\exports\\target_user_manual_export_2025-10-29T10-30-45-123Z.json",
  "timestamp": "2025-10-29T10:30:45.123Z"
}
```

### 2. Export Any User Data
```
GET http://localhost:5000/api/userdata/export/{userId}
```

Example:
```
GET http://localhost:5000/api/userdata/export/RC0HRMUeGQVQtAzB3rMzukxnLb62
```

### 3. Get User Data Summary (No File)
```
GET http://localhost:5000/api/userdata/summary/{userId}
```

Example:
```
GET http://localhost:5000/api/userdata/summary/RC0HRMUeGQVQtAzB3rMzukxnLb62
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "userId": "RC0HRMUeGQVQtAzB3rMzukxnLb62",
    "fetchedAt": "2025-10-29T10:30:45.123Z",
    "totalCollections": 8,
    "collectionsWithData": ["users", "appointments", "reminders", "notifications"],
    "collectionCounts": {
      "users": 1,
      "appointments": 5,
      "reminders": 3,
      "notifications": 7
    },
    "totalDocuments": 16
  }
}
```

## Data Sources

The export system searches these locations:

### Firebase Collections Checked:
- `users` - User profile and preferences
- `appointments` - User appointments
- `reminders` - User reminders
- `tokens` - Authentication tokens
- `notifications` - Push notifications
- `conversations` - Chat/call conversations
- `callHistory` - Phone call logs
- `userPreferences` - User settings
- `medicalRecords` - Medical data
- `documents` - User documents
- `contacts` - User contacts
- `phoneNumbers` - Phone number records
- `sessions` - User sessions
- `devices` - User devices/FCM tokens

### Search Methods:
1. **User Profile**: `users/{userId}`
2. **User Subcollections**: `users/{userId}/{collection}`
3. **Top-level Collections**: `{collection}` where `userId == {userId}`
4. **Collection Groups**: All nested collections with `userId == {userId}`

## Export File Format

The exported JSON file contains:

```json
{
  "userId": "RC0HRMUeGQVQtAzB3rMzukxnLb62",
  "fetchedAt": "2025-10-29T10:30:45.123Z",
  "collections": {
    "users": {
      "profile": {
        "id": "RC0HRMUeGQVQtAzB3rMzukxnLb62",
        "name": "User Name",
        "email": "user@example.com",
        // ... other user data
      }
    },
    "appointments": [
      {
        "id": "appointment_id_1",
        "userId": "RC0HRMUeGQVQtAzB3rMzukxnLb62",
        "date": "2025-10-30T14:00:00Z",
        // ... appointment data
      }
    ],
    // ... other collections
  },
  "summary": {
    "userId": "RC0HRMUeGQVQtAzB3rMzukxnLb62",
    "fetchedAt": "2025-10-29T10:30:45.123Z",
    "totalCollections": 8,
    "collectionsWithData": ["users", "appointments", "reminders"],
    "totalDocuments": 16
  }
}
```

## File Location

All exported files are saved to:
```
AivaBackend/exports/
```

### File Naming:
- **Startup Export**: `user_RC0HRMUeGQVQtAzB3rMzukxnLb62_startup_export.json`
- **Manual Export**: `user_{userId}_{timestamp}.json`
- **Target User Manual**: `target_user_manual_export_{timestamp}.json`

## Usage Instructions

### 1. Start Server (Automatic Export)
```powershell
npm start
```

The export will happen automatically and you'll see the results in the console.

### 2. Manual Export via Browser/Postman
Open in browser or use Postman:
```
http://localhost:5000/api/userdata/export-target
```

### 3. Check Exported Files
```powershell
ls exports/
```

### 4. View Exported Data
```powershell
Get-Content exports/user_RC0HRMUeGQVQtAzB3rMzukxnLb62_startup_export.json | ConvertFrom-Json
```

## Error Handling

The system handles errors gracefully:

- ✅ **Missing Collections**: Skips collections that don't exist
- ✅ **Permission Errors**: Logs warnings but continues
- ✅ **Network Issues**: Retries and logs errors
- ✅ **Server Startup**: Export failure won't crash the server
- ✅ **File System**: Creates directories if they don't exist

## Security Notes

- 🔒 **No Authentication**: These endpoints are currently unprotected
- 🔒 **Sensitive Data**: Exported files may contain sensitive information
- 🔒 **File Access**: Ensure the `exports/` directory has proper permissions
- 🔒 **Production Use**: Consider adding authentication for manual export endpoints

## Troubleshooting

### Issue: No data found
**Check:**
1. User ID is correct: `RC0HRMUeGQVQtAzB3rMzukxnLb62`
2. Firebase permissions allow reading all collections
3. Network connectivity to Firebase

### Issue: Export file not created
**Check:**
1. Write permissions on `exports/` directory
2. Disk space available
3. Check console for error messages

### Issue: Partial data exported
**Check:**
1. Firebase security rules for all collections
2. Console logs for specific collection errors
3. Network timeouts

## Logs to Monitor

```
[INFO] 🚀 Starting user data export...
[INFO] Fetching all data for user: RC0HRMUeGQVQtAzB3rMzukxnLb62
[INFO] ✅ Found user profile
[INFO] ✅ Found X documents in collection Y
[INFO] ✅ Total documents found: X
[INFO] ✅ User data saved to: /path/to/file.json
[INFO] 🎉 Export completed successfully
```

Error logs:
```
[ERROR] Failed to fetch from collection X: error message
[WARN] ❌ User profile not found in users collection
[ERROR] ❌ User data export failed: error message
```

---

**Ready to go!** Start your server with `npm start` and the export will happen automatically! 🚀