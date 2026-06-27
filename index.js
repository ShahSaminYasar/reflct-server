import dotenv from "dotenv";
dotenv.config();

import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import express from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

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
  //   await client.connect();
  //   await client.db("admin").command({ ping: 1 });

  //   COLLECTIONS
  const db = client.db("reflct");
  const lessonsCollection = db.collection("lessons");
  const usersCollection = db.collection("user");
  const favoritesCollection = db.collection("favorites");
  const commentsCollection = db.collection("comments");
  const reportsCollection = db.collection("lessonsReports");

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
    advanced: {
      cookies: {
        session_token: {
          attributes: {
            sameSite: "none",
            secure: true,
            httpOnly: true,
          },
        },
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

  // ====== Lesson Liking ======
  app.patch("/api/lessons/:id/like", verifySession, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
      if (!lesson)
        return res.status(404).json({ ok: false, message: "Lesson not found" });

      const alreadyLiked = lesson.likes?.includes(userId);

      await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        alreadyLiked
          ? { $pull: { likes: userId }, $inc: { likesCount: -1 } }
          : { $addToSet: { likes: userId }, $inc: { likesCount: 1 } },
      );

      res.json({
        ok: true,
        data: {
          liked: !alreadyLiked,
        },
        message: `${!alreadyLiked ? "Unliked" : "Liked"}`,
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to toggle like" });
    }
  });

  // ====== Lesson Favoriting ======
  app.patch("/api/lessons/:id/favorite", verifySession, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const existing = await favoritesCollection.findOne({
        lessonId: id,
        userId,
      });

      if (existing) {
        await favoritesCollection.deleteOne({ lessonId: id, userId });
        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { favoritesCount: -1 } },
        );
        return res.json({ ok: true, message: "Removed from favorites" });
      }

      await favoritesCollection.insertOne({
        lessonId: id,
        userId,
        savedAt: new Date(),
      });
      await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { favoritesCount: 1 } },
      );

      res.json({ ok: true, message: "Added to favorites" });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to toggle favorite" });
    }
  });

  //   ====== Lesson Delete ======
  app.delete("/api/lessons/:id", verifySession, async (req, res) => {
    try {
      const { id } = req.params;

      const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });

      if (!lesson) {
        return res.status(404).json({ ok: false, message: "Lesson not found" });
      }

      if (lesson.authorId !== req.user.id) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }

      await lessonsCollection.deleteOne({ _id: new ObjectId(id) });

      res.json({ ok: true, message: "Lesson deleted successfully" });
    } catch (error) {
      console.error("Delete Lesson Error:", error);
      res.status(500).json({ ok: false, message: "Failed to delete lesson" });
    }
  });

  //   ====== Get Single Lesson ======
  app.get("/api/lessons/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const lesson = await lessonsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!lesson) {
        return res.status(404).json({ ok: false, message: "Lesson not found" });
      }

      const author = await usersCollection.findOne(
        { _id: new ObjectId(lesson.authorId) },
        { projection: { name: 1, image: 1, isPremium: 1 } },
      );

      res.json({
        ok: true,
        data: {
          ...lesson,
          author: author || null,
        },
        message: "Lesson fetched successfully",
      });
    } catch (error) {
      console.error("Get Lesson Error:", error);
      res.status(500).json({ ok: false, message: "Failed to fetch lesson" });
    }
  });

  //   ====== Lesson Edit ======
  app.patch("/api/lessons/:id", verifySession, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        category,
        emotionalTone,
        visibility,
        accessLevel,
        image,
      } = req.body;

      // Validation
      if (!title || !description || !category || !emotionalTone) {
        return res.status(400).json({
          ok: false,
          message: "Missing required fields",
        });
      }

      const lesson = await lessonsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!lesson) {
        return res.status(404).json({ ok: false, message: "Lesson not found" });
      }

      if (lesson.authorId !== req.user.id) {
        return res
          .status(403)
          .json({ ok: false, message: "Not authorized to edit this lesson" });
      }

      let finalAccessLevel = accessLevel || lesson.accessLevel;
      if (!req.user.isPremium && finalAccessLevel === "premium") {
        finalAccessLevel = "free";
      }

      const updateData = {
        title,
        description,
        category,
        emotionalTone,
        visibility: visibility || lesson.visibility,
        accessLevel: finalAccessLevel,
        image: image !== undefined ? image : lesson.image,
        updatedAt: new Date(),
      };

      const result = await lessonsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData },
      );

      if (result.modifiedCount === 0) {
        return res.json({ ok: true, message: "No changes were made" });
      }

      res.json({
        ok: true,
        message: "Lesson updated successfully",
      });
    } catch (error) {
      console.error("Update Lesson Error:", error);
      res.status(500).json({
        ok: false,
        message: "Failed to update lesson",
      });
    }
  });

  //   ====== Lessons ======
  app.get("/api/lessons", async (req, res) => {
    try {
      const {
        category,
        emotionalTone,
        search,
        sort = "newest",
        page = 1,
      } = req.query;
      const limit = 9;
      const skip = (parseInt(page) - 1) * limit;

      const filter = { visibility: "public" };
      if (category) filter.category = category;
      if (emotionalTone) filter.emotionalTone = emotionalTone;
      if (search) filter.title = { $regex: search, $options: "i" };

      const sortOption =
        sort === "most-saved" ? { favoritesCount: -1 } : { createdAt: -1 };

      const [lessons, total] = await Promise.all([
        lessonsCollection
          .find(filter)
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .toArray(),
        lessonsCollection.countDocuments(filter),
      ]);

      res.json({
        ok: true,
        data: lessons,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch lessons" });
    }
  });

  console.log("Pinged your deployment. You successfully connected to MongoDB!");
}
run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
