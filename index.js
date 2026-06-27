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

  //   COLLECTIONS
  const db = client.db("reflct");
  const lessonsCollection = db.collection("lessons");

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
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      credentials: true,
    }),
  );

  // Better Auth routes — must be before express.json()
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json());

  // Session verification middleware
  async function verifySession(req, res, next) {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      req.user = session.user;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Invalid session" });
    }
  }

  // ======= ROUTES =======
  app.get("/", (req, res) => res.send("Reflct API running"));

  //   ======= New Lesson =======
  app.post("/api/lessons", verifySession, async (req, res) => {
    try {
      const {
        title,
        description,
        category,
        emotionalTone,
        visibility = "public",
        accessLevel = "free",
        image,
      } = req.body;

      if (!title || !description || !category || !emotionalTone) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      let finalAccessLevel = accessLevel;
      if (!req.user.isPremium && accessLevel === "premium") {
        finalAccessLevel = "free";
      }

      const newLesson = {
        title,
        description,
        category,
        emotionalTone,
        visibility,
        accessLevel: finalAccessLevel,
        image: image || null,
        authorId: req.user.id,
        likes: [],
        likesCount: 0,
        favoritesCount: 0,
        isFeatured: false,
        isReviewed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await lessonsCollection.insertOne(newLesson);

      res.status(201).json({
        ok: true,
        insertedId: result.insertedId,
        message: "Lesson created successfully",
      });
    } catch (error) {
      console.error("Add Lesson Error:", error);
      res.status(500).json({ message: "Failed to create lesson" });
    }
  });
}

run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
