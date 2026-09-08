import { describe, expect, it } from "vitest";
import { razonesParaNoArchivar, razonesParaNoBorrar } from "./categorias-borrado";

describe("razonesParaNoBorrar", () => {
  const archivada = { kind: "tecnica", isActive: false };

  it("una técnica archivada y sin hijas se puede borrar", () => {
    expect(razonesParaNoBorrar(archivada, 0)).toEqual([]);
  });

  it("con hijas no se borra", () => {
    expect(razonesParaNoBorrar(archivada, 3)[0]).toContain("3 subcategoría");
  });

  it("activa no se borra", () => {
    expect(razonesParaNoBorrar({ kind: "tecnica", isActive: true }, 0)[0]).toContain("está activa");
  });

  it("acumula los dos motivos", () => {
    expect(razonesParaNoBorrar({ kind: "tecnica", isActive: true }, 2)).toHaveLength(2);
  });

  it("un ÁREA no se borra nunca, ni archivada y sin hijas", () => {
    // Esto es lo que pasó de verdad el 2026-09-08: se borraron desde la
    // papelera "Medicina y Dermatología" y "Masajes y Bienestar", que estaban
    // archivadas y parecían vacías. Se llevaron puestos 70 vínculos
    // servicio→área y dejaron dos pestañas del panel sin nada.
    const razones = razonesParaNoBorrar({ kind: "area", isActive: false }, 0);
    expect(razones).toHaveLength(1);
    expect(razones[0]).toContain("pestaña");
  });

  it("el área manda sobre los otros motivos: se dice el que importa", () => {
    // Si dijera "archivala primero", la usuaria la archivaría y volvería a
    // intentar. El motivo tiene que ser el que no tiene salida.
    const razones = razonesParaNoBorrar({ kind: "area", isActive: true }, 5);
    expect(razones).toHaveLength(1);
    expect(razones[0]).toContain("pestaña");
  });

  it("kind desconocido o ausente se trata como técnica, no como área", () => {
    // Ante la duda, no bloquear de más: `kind` tiene default 'tecnica' desde la
    // 1.37.0 pero una fila vieja podría venir en null.
    expect(razonesParaNoBorrar({ kind: null, isActive: false }, 0)).toEqual([]);
  });
});

describe("razonesParaNoArchivar", () => {
  it("una técnica se archiva sin problema", () => {
    expect(razonesParaNoArchivar({ kind: "tecnica" })).toEqual([]);
  });

  it("un área no se archiva: su pestaña queda vacía", () => {
    // 'Estética' quedó archivada y desapareció del modal de Nuevo Servicio,
    // aunque su pestaña seguía existiendo.
    expect(razonesParaNoArchivar({ kind: "area" })[0]).toContain("pestaña");
  });

  it("restaurar nunca se bloquea", () => {
    // Sólo se evalúa al archivar. Restaurar siempre tiene que poder hacerse:
    // es justamente la salida cuando algo quedó archivado por error.
    expect(razonesParaNoArchivar({ kind: "area" }, true)).toEqual([]);
  });
});
