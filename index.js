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

  async function verifyAdmin(req, res, next) {
    if (req.user?.role !== "admin") {
      return res
        .status(403)
        .json({ ok: false, message: "Only admins allowed" });
    }
    next();
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

  // Featured lessons for home page
  app.get("/api/lessons/featured", async (req, res) => {
    try {
      const lessons = await lessonsCollection
        .find({ isFeatured: true, visibility: "public" })
        .sort({ updatedAt: -1 })
        .limit(6)
        .toArray();

      res.json({ ok: true, data: lessons });
    } catch (error) {
      res
        .status(500)
        .json({ ok: false, message: "Failed to fetch featured lessons" });
    }
  });

  // Top contributors of the week
  app.get("/api/contributors/top", async (req, res) => {
    try {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const topContributors = await lessonsCollection
        .aggregate([
          { $match: { createdAt: { $gte: oneWeekAgo } } },
          { $group: { _id: "$authorId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 6 },
          { $addFields: { authorObjectId: { $toObjectId: "$_id" } } },
          {
            $lookup: {
              from: "user",
              localField: "authorObjectId",
              foreignField: "_id",
              as: "author",
            },
          },
          { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              authorId: "$_id",
              count: 1,
              name: "$author.name",
              image: "$author.image",
            },
          },
        ])
        .toArray();

      res.json({ ok: true, data: topContributors });
    } catch (error) {
      res
        .status(500)
        .json({ ok: false, message: "Failed to fetch contributors" });
    }
  });

  // Most saved lessons
  app.get("/api/lessons/most-saved", async (req, res) => {
    try {
      const lessons = await lessonsCollection
        .find({ visibility: "public" })
        .sort({ favoritesCount: -1 })
        .limit(6)
        .toArray();

      res.json({ ok: true, data: lessons });
    } catch (error) {
      res
        .status(500)
        .json({ ok: false, message: "Failed to fetch most saved lessons" });
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

  //   ======= Lesson's Access Level ======
  app.patch(
    "/api/lessons/:id/access-level",
    verifySession,
    async (req, res) => {
      try {
        const { id } = req.params;
        const { accessLevel } = req.body;

        if (!["free", "premium"].includes(accessLevel)) {
          return res.status(400).json({
            ok: false,
            message: "Access level must be 'free' or 'premium'",
          });
        }

        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!lesson) {
          return res
            .status(404)
            .json({ ok: false, message: "Lesson not found" });
        }

        if (lesson?.authorId !== req.user.id) {
          return res.status(403).json({ ok: false, message: "Forbidden" });
        }

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              accessLevel,
              updatedAt: new Date(),
            },
          },
        );

        if (result.modifiedCount === 0) {
          return res
            .status(400)
            .json({ ok: false, message: "No changes made" });
        }

        res.json({
          ok: true,
          message: `Lesson acess level updated to ${accessLevel}`,
        });
      } catch (error) {
        console.error("Update Visibility Error:", error);
        res.status(500).json({
          success: false,
          error: "Failed to update visibility",
        });
      }
    },
  );

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
        message: `${alreadyLiked ? "Unliked" : "Liked"}`,
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

  //   ====== Report a Lesson ======
  app.post("/api/lessons/:id/report", verifySession, async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason)
        return res
          .status(400)
          .json({ ok: false, message: "Reason is required" });

      const existing = await reportsCollection.findOne({
        lessonId: id,
        reporterUserId: req.user.id,
      });

      if (existing) {
        return res
          .status(400)
          .json({ ok: false, message: "You already reported this lesson" });
      }

      await reportsCollection.insertOne({
        lessonId: id,
        reporterUserId: req.user.id,
        reportedUserEmail: req.user.email,
        reason,
        timestamp: new Date(),
      });

      res.json({ ok: true, message: "Lesson reported successfully" });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to report lesson" });
    }
  });

  // ====== Comments GET ======
  app.get("/api/lessons/:id/comments", async (req, res) => {
    try {
      const comments = await commentsCollection
        .find({ lessonId: req.params.id })
        .sort({ createdAt: -1 })
        .toArray();
      res.json({ ok: true, data: comments });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch comments" });
    }
  });

  // ====== Comments POST ======
  app.post("/api/lessons/:id/comments", verifySession, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text)
        return res
          .status(400)
          .json({ ok: false, message: "Comment text required" });

      const comment = {
        lessonId: req.params.id,
        userId: req.user.id,
        userName: req.user.name,
        userImage: req.user.image || "",
        text,
        createdAt: new Date(),
      };

      await commentsCollection.insertOne(comment);
      res.status(201).json({ ok: true, data: comment });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to post comment" });
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

      const postsCount = await lessonsCollection.countDocuments({
        authorId: lesson.authorId,
      });

      res.json({
        ok: true,
        data: {
          ...lesson,
          author: { ...author, totalPosts: postsCount } || null,
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
      const limit = 6;
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

      const lessonsWithAuthors = await Promise.all(
        lessons.map(async (lesson) => {
          const author = await usersCollection.findOne(
            { _id: new ObjectId(lesson.authorId) },
            {
              projection: {
                name: 1,
                image: 1,
                email: 1,
              },
            },
          );

          return {
            ...lesson,
            author,
          };
        }),
      );

      res.json({
        ok: true,
        data: lessonsWithAuthors,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch lessons" });
    }
  });

  //   ====== Favorites ======
  app.get("/api/favorites", verifySession, async (req, res) => {
    try {
      const { category, emotionalTone } = req.query;

      const userFavorites = await favoritesCollection
        .find({ userId: req.user.id })
        .sort({ savedAt: -1 })
        .toArray();

      if (userFavorites.length === 0) {
        return res.json({ ok: true, data: [] });
      }

      const lessonIds = userFavorites.map((f) => new ObjectId(f.lessonId));

      const filter = { _id: { $in: lessonIds } };
      if (category) filter.category = category;
      if (emotionalTone) filter.emotionalTone = emotionalTone;

      const lessons = await lessonsCollection.find(filter).toArray();

      // Preserve savedAt order
      const savedAtMap = {};
      userFavorites.forEach((f) => {
        savedAtMap[f.lessonId] = f.savedAt;
      });

      const data = lessons.map((l) => ({
        ...l,
        savedAt: savedAtMap[l._id.toString()],
      }));

      res.json({ ok: true, data, message: "Favorites fetched successfully" });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch favorites" });
    }
  });

  // ====== Get user profile + their public lessons ======
  app.get("/api/profile/:userId", async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            isPremium: 1,
            role: 1,
            createdAt: 1,
          },
        },
      );

      if (!user)
        return res.status(404).json({ ok: false, message: "User not found" });

      const [lessons, favoritesCount, lessonsCount] = await Promise.all([
        lessonsCollection
          .find({ authorId: userId, visibility: "public" })
          .sort({ createdAt: -1 })
          .toArray(),
        favoritesCollection.countDocuments({ userId }),
        lessonsCollection.countDocuments({ authorId: userId }),
      ]);

      res.json({
        ok: true,
        data: {
          user: { ...user, lessonsCount, favoritesCount },
          lessons,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch profile" });
    }
  });

  // ====== Update own profile ======
  app.patch("/api/profile", verifySession, async (req, res) => {
    try {
      const { name, image } = req.body;

      if (!name)
        return cursor
          .status(400)
          .json({ ok: false, message: "Name is required" });

      const cursor = await usersCollection.updateOne(
        { _id: new ObjectId(req.user.id) },
        {
          $set: { name, image: image || req.user.image, updatedAt: new Date() },
        },
      );

      if (cursor.modifiedCount > 0) {
        res.json({ ok: true, message: "Profile updated successfully" });
      } else {
        res.json({ ok: false, message: "Data was not modified" });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, message: "Failed to update profile" });
    }
  });

  // ====== Dashboard Stats ======
  app.get("/api/dashboard/stats", verifySession, async (req, res) => {
    try {
      const userId = req.user.id;

      const [lessonsCount, favoritesCount, recentLessons] = await Promise.all([
        lessonsCollection.countDocuments({ authorId: userId }),
        favoritesCollection.countDocuments({ userId }),
        lessonsCollection
          .find({ authorId: userId })
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray(),
      ]);

      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        date.setHours(0, 0, 0, 0);
        return date;
      });

      const weeklyData = await Promise.all(
        last7Days.map(async (date) => {
          const nextDay = new Date(date);
          nextDay.setDate(nextDay.getDate() + 1);
          const count = await lessonsCollection.countDocuments({
            authorId: userId,
            createdAt: { $gte: date, $lt: nextDay },
          });
          return {
            day: date.toLocaleDateString("en-US", { weekday: "short" }),
            lessons: count,
          };
        }),
      );

      res.json({
        ok: true,
        data: {
          lessonsCount,
          favoritesCount,
          recentLessons,
          weeklyData,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch stats" });
    }
  });

  //   ==========================
  //   ====== ADMIN ROUTES ======
  //   ==========================

  //   Stats
  app.get("/api/admin/stats", verifySession, verifyAdmin, async (req, res) => {
    try {
      const [totalUsers, totalPublicLessons, reportedResult, todayLessons] =
        await Promise.all([
          usersCollection.countDocuments(),

          lessonsCollection.countDocuments({
            visibility: "public",
          }),

          reportsCollection
            .aggregate([
              {
                $group: {
                  _id: "$lessonId",
                },
              },
              {
                $count: "count",
              },
            ])
            .toArray(),

          lessonsCollection.countDocuments({
            createdAt: {
              $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          }),
        ]);

      const totalReportedLessons =
        reportedResult.length > 0 ? reportedResult[0].count : 0;

      const topContributors = await lessonsCollection
        .aggregate([
          {
            $group: {
              _id: "$authorId",
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 5 },
          {
            $addFields: {
              authorObjectId: { $toObjectId: "$_id" }, // convert string → ObjectId
            },
          },
          {
            $lookup: {
              from: "user",
              localField: "authorObjectId",
              foreignField: "_id", // match against ObjectId _id
              as: "author",
            },
          },
          {
            $unwind: {
              path: "$author",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 0,
              authorId: "$_id",
              count: 1,
              name: "$author.name",
              email: "$author.email",
              image: "$author.image",
            },
          },
        ])
        .toArray();

      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        date.setHours(0, 0, 0, 0);
        return date;
      });

      const lessonGrowth = await Promise.all(
        last7Days.map(async (date) => {
          const nextDay = new Date(date);
          nextDay.setDate(nextDay.getDate() + 1);
          const count = await lessonsCollection.countDocuments({
            createdAt: { $gte: date, $lt: nextDay },
          });
          return {
            day: date.toLocaleDateString("en-US", { weekday: "short" }),
            lessons: count,
          };
        }),
      );

      const userGrowth = await Promise.all(
        last7Days.map(async (date) => {
          const nextDay = new Date(date);
          nextDay.setDate(nextDay.getDate() + 1);

          const users = await usersCollection.countDocuments({
            createdAt: {
              $gte: date,
              $lt: nextDay,
            },
          });

          return {
            day: date.toLocaleDateString("en-US", {
              weekday: "short",
            }),
            users,
          };
        }),
      );

      res.json({
        ok: true,
        data: {
          totalUsers,
          totalPublicLessons,
          totalReportedLessons,
          todayLessons,
          topContributors,
          lessonGrowth,
          userGrowth,
        },
      });
    } catch (error) {
      console.log("ERROR", error);
      res
        .status(500)
        .json({ ok: false, message: "Failed to fetch admin stats" });
    }
  });

  //   ====== Get Users ======
  app.get("/api/admin/users", verifySession, verifyAdmin, async (req, res) => {
    try {
      const users = await usersCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      const usersWithCounts = await Promise.all(
        users.map(async (user) => {
          const lessonsCount = await lessonsCollection.countDocuments({
            authorId: user._id.toString(),
          });
          return { ...user, lessonsCount };
        }),
      );

      res.json({ ok: true, data: usersWithCounts });
    } catch (error) {
      res.status(500).json({ ok: false, message: "Failed to fetch users" });
    }
  });

  //   ====== Promote/Demote User (Role) ======
  app.patch(
    "/api/admin/users/:userId/role",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        const { role } = req.body;
        if (!["user", "admin"].includes(role)) {
          return res.status(400).json({ ok: false, message: "Invalid role" });
        }

        const cursor = await usersCollection.updateOne(
          { _id: new ObjectId(req.params.userId) },
          { $set: { role } },
        );

        if (cursor?.modifiedCount > 0) {
          res.json({ ok: true, message: `User role updated to ${role}` });
        } else {
          res.json({ ok: false, message: "Failed to change role" });
        }
      } catch (error) {
        res.status(500).json({ ok: false, message: "Failed to update role" });
      }
    },
  );

  //   ====== Get Admin Lessons ======
  app.get(
    "/api/admin/lessons",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        const { category, visibility, flagged } = req.query;

        const filter = {};
        if (category) filter.category = category;
        if (visibility) filter.visibility = visibility;

        const lessons = await lessonsCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray();

        if (flagged === "true") {
          const reportedAgg = await reportsCollection
            .aggregate([{ $group: { _id: "$lessonId" } }])
            .toArray();
          const reportedIds = reportedAgg.map((r) => r._id);
          const flaggedLessons = lessons.filter((l) =>
            reportedIds.includes(l._id.toString()),
          );

          const flaggedWithReports = await Promise.all(
            flaggedLessons.map(async (lesson) => {
              const reportCount = await reportsCollection.countDocuments({
                lessonId: lesson._id.toString(),
              });
              return { ...lesson, reportCount };
            }),
          );

          return res.json({ ok: true, data: flaggedWithReports });
        }

        const lessonsWithReports = await Promise.all(
          lessons.map(async (lesson) => {
            const reportCount = await reportsCollection.countDocuments({
              lessonId: lesson._id.toString(),
            });
            return { ...lesson, reportCount };
          }),
        );

        res.json({ ok: true, data: lessonsWithReports });
      } catch (error) {
        res.status(500).json({ ok: false, message: "Failed to fetch lessons" });
      }
    },
  );

  //   ====== Toggle Featured ======
  app.patch(
    "/api/admin/lessons/:id/featured",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!lesson)
          return res
            .status(404)
            .json({ ok: false, message: "Lesson doesn't exist" });

        await lessonsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { isFeatured: !lesson.isFeatured, updatedAt: new Date() } },
        );

        res.json({
          ok: true,
          data: {
            isFeatured: !lesson.isFeatured,
          },
          message: lesson.isFeatured
            ? "Lesson removed from featured"
            : "Lesson added to featured",
        });
      } catch (error) {
        res
          .status(500)
          .json({ ok: false, message: "Failed to toggle featured" });
      }
    },
  );

  //   ====== Toggle Reviewed ======
  app.patch(
    "/api/admin/lessons/:id/reviewed",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!lesson)
          return res
            .status(404)
            .json({ ok: false, message: "Lesson does not exist" });

        await lessonsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { isReviewed: !lesson.isReviewed, updatedAt: new Date() } },
        );

        res.json({
          ok: true,
          data: { isReviewed: !lesson.isReviewed },
          message: lesson.isReviewed
            ? "Lesson marked as not reviewed"
            : "Lesson marked as reviewed",
        });
      } catch (error) {
        res
          .status(500)
          .json({ ok: false, message: "Failed to toggle reviewed" });
      }
    },
  );

  //   ====== Delete Lesson by Admin ======
  app.delete(
    "/api/admin/lessons/:id",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        await lessonsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        await reportsCollection.deleteMany({ lessonId: req.params.id });
        res.json({ ok: true, message: "Lesson deleted successfully" });
      } catch (error) {
        res.status(500).json({ ok: false, message: "Failed to delete lesson" });
      }
    },
  );

  //   ====== Get Reported Lessons ======
  app.get(
    "/api/admin/reported-lessons",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        const reportedAgg = await reportsCollection
          .aggregate([{ $group: { _id: "$lessonId" } }])
          .toArray();
        const reportedIds = reportedAgg.map((r) => r._id);

        const lessons = await Promise.all(
          reportedIds.map(async (lessonId) => {
            const lesson = await lessonsCollection.findOne({
              _id: new ObjectId(lessonId),
            });
            const reports = await reportsCollection
              .find({ lessonId })
              .toArray();
            return lesson
              ? { ...lesson, reports, reportCount: reports.length }
              : null;
          }),
        );

        res.json({
          ok: true,
          data: lessons
            .filter(Boolean)
            .sort((a, b) => b.reportCount - a.reportCount),
        });
      } catch (error) {
        res
          .status(500)
          .json({ ok: false, message: "Failed to fetch reported lessons" });
      }
    },
  );

  //   ====== Report Deletion (Ignored by Admin) ======
  app.delete(
    "/api/admin/reported-lessons/:id/ignore",
    verifySession,
    verifyAdmin,
    async (req, res) => {
      try {
        await reportsCollection.deleteMany({ lessonId: req.params.id });
        res.json({ ok: true, message: "Reports cleared" });
      } catch (error) {
        res.status(500).json({ ok: false, message: "Failed to clear reports" });
      }
    },
  );

  app.post("/api/premium-subscribed", async (req, res) => {
    try {
      const { userEmail } = req.body;
      await usersCollection.updateOne(
        { email: userEmail },
        {
          $set: {
            isPremium: true,
            updatedAt: new Date(),
          },
        },
      );
      res.json({ ok: true, message: "Premium registered" });
    } catch (error) {
      res
        .status(500)
        .json({ ok: false, message: "Failed to mark as premium user" });
    }
  });

  console.log("Pinged your deployment. You successfully connected to MongoDB!");
}
run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));
