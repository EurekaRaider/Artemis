import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export interface PluginDirectoryMove {
  destination: string;
  backup: string;
  stage?: string;
}
interface Journal<S, M> {
  version: 1;
  committed: boolean;
  moves: Array<PluginDirectoryMove & { existed: boolean }>;
  previousStore: S;
  nextStore: S;
  previousMcp: M;
}
const exists = async (path: string) =>
  stat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
export class PluginInstallTransaction<S, M> {
  constructor(
    private readonly options: {
      journalPath: string;
      statePath: string;
      roots: string[];
      saveStore(value: S): Promise<void>;
      saveMcp(value: M): Promise<void>;
    },
  ) {}
  private async write(value: Journal<S, M>): Promise<void> {
    const path = this.options.journalPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(value), {
      mode: 0o600,
      flush: true,
    });
    await rename(`${path}.tmp`, path);
  }
  async recover(): Promise<void> {
    let journal: Journal<S, M>;
    try {
      journal = JSON.parse(
        await readFile(this.options.journalPath, "utf8"),
      ) as Journal<S, M>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (
      journal.version !== 1 ||
      typeof journal.committed !== "boolean" ||
      !Array.isArray(journal.moves)
    )
      throw new Error("Invalid plugin installation journal");
    const roots = new Set(this.options.roots.map((root) => resolve(root)));
    for (const move of journal.moves) {
      for (const path of [
        move.destination,
        move.backup,
        ...(move.stage ? [move.stage] : []),
      ]) {
        if (!roots.has(dirname(resolve(path))))
          throw new Error("Plugin transaction path escapes installation roots");
      }
      if (
        typeof move.existed !== "boolean" ||
        new Set(
          [
            move.destination,
            move.backup,
            ...(move.stage ? [move.stage] : []),
          ].map((path) => resolve(path)),
        ).size !== (move.stage ? 3 : 2)
      )
        throw new Error("Invalid transaction paths");
    }
    // The durable journal flag is the commit point. Until it is written,
    // recovery restores all three resources, even if the primary store was
    // saved or is identical to its previous value (for example a reinstall).
    if (!journal.committed) {
      for (const move of [...journal.moves].reverse()) {
        if (await exists(move.backup)) {
          await rm(move.destination, { recursive: true, force: true });
          await rename(move.backup, move.destination);
        } else if (
          !move.existed &&
          (!move.stage || !(await exists(move.stage)))
        ) {
          await rm(move.destination, { recursive: true, force: true });
        }
      }
      await this.options.saveMcp(journal.previousMcp);
      await this.options.saveStore(journal.previousStore);
    }
    for (const move of journal.moves) {
      await rm(move.backup, { recursive: true, force: true });
      if (move.stage) await rm(move.stage, { recursive: true, force: true });
    }
    await rm(this.options.journalPath);
  }
  async commit(
    moves: PluginDirectoryMove[],
    previousStore: S,
    nextStore: S,
    previousMcp: M,
    nextMcp: M,
  ): Promise<void> {
    // Never replace an unresolved journal with a new transaction.
    if (await exists(this.options.journalPath))
      throw new Error(
        "A previous plugin installation requires recovery before retrying",
      );
    const journal: Journal<S, M> = {
      version: 1,
      committed: false,
      previousStore,
      nextStore,
      previousMcp,
      moves: await Promise.all(
        moves.map(async (move) => ({
          ...move,
          existed: await exists(move.destination),
        })),
      ),
    };
    await this.write(journal);
    try {
      for (const move of journal.moves)
        if (move.existed) await rename(move.destination, move.backup);
      for (const move of journal.moves)
        if (move.stage) await rename(move.stage, move.destination);
      await this.options.saveMcp(nextMcp);
      await this.options.saveStore(nextStore);
      journal.committed = true;
      await this.write(journal);
    } catch (error) {
      await this.recover();
      throw error;
    }
    await this.recover();
  }
}
