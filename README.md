# Reflct Server — REST API

Backend server for the Reflct Digital Life Lessons platform. Built with Express.js and MongoDB Atlas.

## 🌐 Live API URL

[https://ssy-reflct-server.vercel.app](https://ssy-reflct-server.vercel.app)

## 📋 Purpose

Provides all REST API endpoints for the Reflct platform including authentication, lesson management, favorites, comments, reports, user profiles, admin controls, and Stripe payment processing.

## 🔗 Client Repository

[https://github.com/ShahSaminYasar/reflct-client](https://github.com/ShahSaminYasar/reflct-client)

## 📦 NPM Packages Used

| Package | Purpose |
|---|---|
| `express` | Web server framework |
| `mongodb` | MongoDB native driver (no Mongoose) |
| `stripe` | Stripe payment + webhook processing |
| `cors` | Cross-origin resource sharing |
| `dotenv` | Environment variable management |

## 🔑 Admin Credentials

| Field    | Value               |
|----------|---------------------|
| Email    | admin@email.com     |
| Password | Admin@123           |

## 🚀 Getting Started Locally

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Stripe account (test mode)

### Setup
```bash
git clone https://github.com/ShahSaminYasar/reflct-server
cd reflct-server
npm install
```

Create `.env`:
```env
BASE_URL=http://localhost:5000
CLIENT_URL=http://localhost:3000
MONGODB_URI=your_mongodb_uri_with_username_&_password_included
BETTER_AUTH_SECRET=secret_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

```bash
npm start
```

## 🗂️ API Endpoints

### Auth (Better Auth)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/auth/sign-in/email` | Public |
| POST | `/api/auth/sign-up/email` | Public |
| POST | `/api/auth/sign-in/social` | Public |
| POST | `/api/auth/sign-out` | Public |

### Lessons
| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/lessons` | Public |
| GET | `/api/lessons/featured` | Public |
| GET | `/api/lessons/most-saved` | Public |
| GET | `/api/lessons/my-lessons` | Protected |
| GET | `/api/lessons/:id` | Public |
| POST | `/api/lessons` | Protected |
| PATCH | `/api/lessons/:id` | Protected (owner) |
| PATCH | `/api/lessons/:id/visibility` | Protected (owner) |
| PATCH | `/api/lessons/:id/like` | Protected |
| DELETE | `/api/lessons/:id` | Protected (owner) |

### Favorites
| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/favorites` | Protected |
| GET | `/api/favorites/:lessonId` | Protected |
| PATCH | `/api/favorites/:lessonId` | Protected |

### Comments
| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/lessons/:id/comments` | Public |
| POST | `/api/lessons/:id/comments` | Protected |

### Reports
| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/lessons/:id/report` | Protected |

### Profile
| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/profile/:userId` | Public |
| PATCH | `/api/profile` | Protected |

### Dashboard
| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/dashboard/stats` | Protected |
| GET | `/api/contributors/top` | Public |

### Admin
| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/admin/stats` | Admin |
| GET | `/api/admin/users` | Admin |
| PATCH | `/api/admin/users/:userId/role` | Admin |
| GET | `/api/admin/lessons` | Admin |
| PATCH | `/api/admin/lessons/:id/featured` | Admin |
| PATCH | `/api/admin/lessons/:id/reviewed` | Admin |
| DELETE | `/api/admin/lessons/:id` | Admin |
| GET | `/api/admin/reported-lessons` | Admin |
| DELETE | `/api/admin/reported-lessons/:id/ignore` | Admin |

### Payments
| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/create-checkout-session` | Protected |
| POST | `/api/webhook` | Stripe |

## 🗃️ MongoDB Collections

| Collection | Key Fields |
|---|---|
| `user` | `_id`, `name`, `email`, `image`, `isPremium`, `role` |
| `lessons` | `title`, `description`, `category`, `emotionalTone`, `visibility`, `accessLevel`, `likes[]`, `likesCount`, `favoritesCount`, `isFeatured`, `isReviewed`, `authorId` |
| `favorites` | `userId`, `lessonId`, `savedAt` |
| `lessonsReports` | `lessonId`, `reporterUserId`, `reportedUserEmail`, `reason`, `timestamp` |
| `comments` | `lessonId`, `userId`, `userName`, `userImage`, `text`, `createdAt` |
| `session` | Better Auth managed |
| `account` | Better Auth managed |

## 💳 Stripe Integration

- One-time payment of ৳1,500 for lifetime Premium access
- Checkout session created server-side with user ID in metadata
- Webhook verifies payment and updates `isPremium: true` in MongoDB
- Webhook route uses `express.raw()` before `express.json()` middleware

## 🌐 Deployment

Deployed on Vercel. Ensure the following environment variables are set in your deployment dashboard.

## ⚠️ Key Notes

- No Mongoose - MongoDB native driver only
- No axios - native fetch only
- `distinct()` not used - replaced with `$group` aggregation
- Stripe webhook registered before `express.json()` middleware
- All routes inside `run()` function after MongoDB connects
- CORS configured with `credentials: true` for cross-domain Bearer tokens

## 📄 License

This project was built for Programming Hero Batch 13 - Assignment 10.