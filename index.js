require("dotenv").config();
const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { bearer } = require("better-auth/plugins");
const { toNodeHandler, fromNodeHeaders } = require("better-auth/node");
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  console.log("Pinged your deployment. You successfully connected to MongoDB!");

  const db = client.db("reflct");

  const auth = betterAuth({
    database: mongodbAdapter(db),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BASE_URL,
    trustedOrigins: [process.env.CLIENT_URL],
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [bearer()],
    user: {
      additionalFields: {
        isPremium: { type: "boolean", defaultValue: false, input: false },
        role: { type: "string", defaultValue: "user", input: false },
      },
    },
  });

  // Middlewares
  app.use(
    cors({
      origin: ["http://localhost:3000"],
      credentials: true,
    }),
  );

  // Better Auth routes — must be before express.json()
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json());

  // Session verification middleware
  async function verifySession(req, res, next) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    req.user = session.user;
    next();
  }

  // ======= ROUTES =======
  app.get("/", (req, res) => res.send("Reflct API running"));
}

run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
