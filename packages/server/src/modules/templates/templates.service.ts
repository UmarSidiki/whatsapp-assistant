import { db } from "../../database";
import { template } from "../../database/schema";
import { eq, and, desc } from "drizzle-orm";
import { ServiceError } from "../whatsapp/wa-socket";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function getTemplates(userId: string): Promise<Template[]> {
  const rows = await db.select().from(template)
    .where(eq(template.userId, userId))
    .orderBy(desc(template.updatedAt));
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    content: r.content,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  }));
}

export async function createTemplate(userId: string, name: string, content: string): Promise<Template> {
  const normalizedName = name.trim();
  const normalizedContent = content.trim();
  if (!normalizedName || !normalizedContent) {
    throw new ServiceError("Template name and content are required", 400);
  }

  const existing = await db.select({ name: template.name }).from(template)
    .where(eq(template.userId, userId));
  const duplicate = existing.some((row) =>
    row.name.trim().toLowerCase() === normalizedName.toLowerCase()
  );
  if (duplicate) throw new ServiceError("A template with this name already exists", 409);

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(template).values({
    id,
    userId,
    name: normalizedName,
    content: normalizedContent,
    createdAt: now,
    updatedAt: now
  });
  return {
    id,
    name: normalizedName,
    content: normalizedContent,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  const [existing] = await db.select().from(template)
    .where(and(eq(template.id, id), eq(template.userId, userId)))
    .limit(1);
  if (!existing) throw new ServiceError("Template not found", 404);
  await db.delete(template).where(eq(template.id, id));
}
