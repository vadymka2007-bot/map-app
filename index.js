var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  insertToiletSchema: () => insertToiletSchema,
  insertUserSchema: () => insertUserSchema,
  toilets: () => toilets,
  updateToiletSchema: () => updateToiletSchema,
  users: () => users
});
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var toilets = pgTable("toilets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  description: text("description"),
  isAccessible: boolean("is_accessible").default(false),
  isFree: boolean("is_free").default(true),
  hasBabyChanging: boolean("has_baby_changing").default(false),
  isApproved: boolean("is_approved").default(false),
  submittedBy: text("submitted_by").default("admin"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var insertToiletSchema = createInsertSchema(toilets).omit({
  id: true,
  createdAt: true
});
var updateToiletSchema = insertToiletSchema.partial();

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle({ client: pool, schema: schema_exports });

// server/storage.ts
import { eq } from "drizzle-orm";
var DatabaseStorage = class {
  async getAllToilets() {
    return await db.select().from(toilets);
  }
  async getToilet(id) {
    const [toilet] = await db.select().from(toilets).where(eq(toilets.id, id));
    return toilet || void 0;
  }
  async createToilet(insertToilet) {
    const [toilet] = await db.insert(toilets).values(insertToilet).returning();
    return toilet;
  }
  async updateToilet(id, data) {
    const [toilet] = await db.update(toilets).set(data).where(eq(toilets.id, id)).returning();
    return toilet || void 0;
  }
  async deleteToilet(id) {
    const result = await db.delete(toilets).where(eq(toilets.id, id)).returning();
    return result.length > 0;
  }
};
var storage = new DatabaseStorage();

// server/routes.ts
import { z } from "zod";
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function toRad(degrees) {
  return degrees * (Math.PI / 180);
}
async function registerRoutes(app2) {
  app2.get("/api/toilets", async (req, res) => {
    try {
      const { lat, lon, radius } = req.query;
      let toilets2 = await storage.getAllToilets();
      if (lat && lon) {
        const userLat = parseFloat(lat);
        const userLon = parseFloat(lon);
        const maxRadius = radius ? parseFloat(radius) : 50;
        toilets2 = toilets2.map((toilet) => ({
          ...toilet,
          distance: calculateDistance(userLat, userLon, toilet.latitude, toilet.longitude)
        })).filter((toilet) => toilet.distance <= maxRadius).sort((a, b) => a.distance - b.distance);
      }
      res.json(toilets2);
    } catch (error) {
      console.error("Error fetching toilets:", error);
      res.status(500).json({ error: "Failed to fetch toilets" });
    }
  });
  app2.get("/api/toilets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const toilet = await storage.getToilet(id);
      if (!toilet) {
        return res.status(404).json({ error: "Toilet not found" });
      }
      res.json(toilet);
    } catch (error) {
      console.error("Error fetching toilet:", error);
      res.status(500).json({ error: "Failed to fetch toilet" });
    }
  });
  app2.post("/api/toilets", async (req, res) => {
    try {
      const validatedData = insertToiletSchema.parse(req.body);
      const safeData = {
        name: validatedData.name,
        latitude: validatedData.latitude,
        longitude: validatedData.longitude,
        description: validatedData.description,
        isAccessible: validatedData.isAccessible,
        isFree: validatedData.isFree,
        hasBabyChanging: validatedData.hasBabyChanging,
        isApproved: false,
        submittedBy: "user"
      };
      const toilet = await storage.createToilet(safeData);
      res.status(201).json(toilet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error creating toilet:", error);
      res.status(500).json({ error: "Failed to create toilet" });
    }
  });
  app2.patch("/api/toilets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = updateToiletSchema.parse(req.body);
      const updateData = {};
      if (validatedData.name !== void 0) updateData.name = validatedData.name;
      if (validatedData.latitude !== void 0) updateData.latitude = validatedData.latitude;
      if (validatedData.longitude !== void 0) updateData.longitude = validatedData.longitude;
      if (validatedData.description !== void 0) updateData.description = validatedData.description;
      if (validatedData.isAccessible !== void 0) updateData.isAccessible = validatedData.isAccessible;
      if (validatedData.isFree !== void 0) updateData.isFree = validatedData.isFree;
      if (validatedData.hasBabyChanging !== void 0) updateData.hasBabyChanging = validatedData.hasBabyChanging;
      if (validatedData.isApproved !== void 0) updateData.isApproved = validatedData.isApproved;
      const toilet = await storage.updateToilet(id, updateData);
      if (!toilet) {
        return res.status(404).json({ error: "Toilet not found" });
      }
      res.json(toilet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating toilet:", error);
      res.status(500).json({ error: "Failed to update toilet" });
    }
  });
  app2.delete("/api/toilets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteToilet(id);
      if (!deleted) {
        return res.status(404).json({ error: "Toilet not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting toilet:", error);
      res.status(500).json({ error: "Failed to delete toilet" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      ),
      await import("@replit/vite-plugin-dev-banner").then(
        (m) => m.devBanner()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
