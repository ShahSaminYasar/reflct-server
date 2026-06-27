require("dotenv").config();
const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { bearer } = require("better-auth/plugins");
const { toNodeHandler, fromNodeHeaders } = require("better-auth/node");
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

  //   ======= My Lessons =======
  app.get("/api/lessons/my-lessons", verifySession, async (req, res) => {
    try {
      const lessons = await lessonsCollection
        .find({ authorId: req.user.id })
        .sort({ createdAt: -1 })
        .toArray();

      res.json({
        ok: true,
        data: lessons,
        message: "Lessons posted by you fetched successfully",
      });
    } catch (error) {
      console.error("Fetch My Lessons Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch your lessons",
      });
    }
  });

  //   ======= Lesson's Visibility ======
  app.patch("/api/lessons/:id/visibility", verifySession, async (req, res) => {
    try {
      const { id } = req.params;
      const { visibility } = req.body;

      if (!["public", "private"].includes(visibility)) {
        return res.status(400).json({
          ok: false,
          message: "Visibility must be 'public' or 'private'",
        });
      }

      const lesson = await lessonsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!lesson) {
        return res.status(404).json({ ok: false, message: "Lesson not found" });
      }

      if (lesson?.authorId !== req.user.id) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }

      const result = await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            visibility,
            updatedAt: new Date(),
          },
        },
      );

      if (result.modifiedCount === 0) {
        return res.status(400).json({ ok: false, message: "No changes made" });
      }

      res.json({
        ok: true,
        message: `Lesson visibility updated to ${visibility}`,
      });
    } catch (error) {
      console.error("Update Visibility Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update visibility",
      });
    }
  });
}

run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
