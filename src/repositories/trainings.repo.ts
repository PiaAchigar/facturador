import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { training } from "../db/schema";

const trainingSummary = {
  id: training.id,
  name: training.name,
  description: training.description,
  modality: training.modality,
  location: training.location,
  totalSessions: training.totalSessions,
  durationPerSessionMinutes: training.durationPerSessionMinutes,
  prerequisitesText: training.prerequisitesText,
  maxParticipants: training.maxParticipants,
  includesCertification: training.includesCertification,
  certificationTitle: training.certificationTitle,
  listPrice: training.listPrice,
  cashPrice: training.cashPrice,
  taxCategory: training.taxCategory,
  isFeatured: training.isFeatured,
  isVisible: training.isVisible,
  webSortOrder: training.webSortOrder,
  isActive: training.isActive,
};

export async function listTrainings(db: Db, filters: { featured?: boolean }) {
  const conditions = [eq(training.isActive, true), eq(training.isVisible, true)];
  if (filters.featured) conditions.push(eq(training.isFeatured, true));

  return db
    .select(trainingSummary)
    .from(training)
    .where(and(...conditions))
    .orderBy(asc(training.webSortOrder), asc(training.name));
}

/**
 * Lista para administración: visibles o no en la web.
 *
 * `includeInactive` suma las archivadas, para la vista "Archivados" de la
 * pantalla de Capacitaciones. Sin el parámetro se comporta como antes, que es
 * lo que espera la pantalla de Sitio Web.
 */
export async function listTrainingsAdmin(db: Db, includeInactive = false) {
  const base = db.select(trainingSummary).from(training);
  const filtrada = includeInactive ? base : base.where(eq(training.isActive, true));
  return filtrada.orderBy(asc(training.webSortOrder), asc(training.name));
}

export async function getTrainingById(db: Db, id: string) {
  const rows = await db
    .select(trainingSummary)
    .from(training)
    .where(eq(training.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Los campos que se editan desde la pantalla de Capacitaciones. */
export type TrainingInput = {
  name: string;
  description?: string | null;
  modality?: string | null;
  location?: string | null;
  totalSessions?: number | null;
  durationPerSessionMinutes?: number | null;
  prerequisitesText?: string | null;
  maxParticipants?: number | null;
  includesCertification?: boolean | null;
  certificationTitle?: string | null;
  listPrice?: number | null;
  cashPrice?: number | null;
  taxCategory?: string | null;
  isVisible?: boolean | null;
  isFeatured?: boolean | null;
  webSortOrder?: number | null;
};

/** Los precios son `decimal` en la base y Drizzle los quiere como string. */
function aColumnas(data: Partial<TrainingInput>) {
  const { listPrice, cashPrice, ...resto } = data;
  return {
    ...resto,
    ...(listPrice !== undefined && { listPrice: listPrice === null ? null : String(listPrice) }),
    ...(cashPrice !== undefined && { cashPrice: cashPrice === null ? null : String(cashPrice) }),
  };
}

export async function createTraining(db: Db, data: TrainingInput) {
  const rows = await db
    .insert(training)
    .values({ ...aColumnas(data), isActive: true })
    .returning(trainingSummary);
  return rows[0]!;
}

/**
 * Actualiza sólo los campos que vengan.
 *
 * Reemplaza a `updateTrainingWebSettings`, que sabía de tres columnas. La
 * pantalla de Sitio Web sigue mandando esas tres y nada cambia para ella; la de
 * Capacitaciones manda el resto.
 */
export async function updateTraining(db: Db, id: string, patch: Partial<TrainingInput>) {
  const columnas = aColumnas(patch);
  if (Object.keys(columnas).length === 0) return getTrainingById(db, id);

  const rows = await db
    .update(training)
    .set({ ...columnas, updatedAt: new Date() })
    .where(eq(training.id, id))
    .returning(trainingSummary);
  return rows[0] ?? null;
}

/** Archiva (false) o restaura (true). Nunca borra: regla 1.3. */
export async function setTrainingActive(db: Db, id: string, isActive: boolean) {
  const rows = await db
    .update(training)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(training.id, id))
    .returning(trainingSummary);
  return rows[0] ?? null;
}
