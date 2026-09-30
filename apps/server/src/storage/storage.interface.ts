export interface Storage {
  put(key: string, srcPath: string): Promise<void>;
  /** 将可读流写入最终 key，返回写入字节数。先写同目录临时文件再 rename。 */
  putStream(key: string, source: NodeJS.ReadableStream): Promise<number>;
  /** 流写入同目录临时文件，不替换已有对象。 */
  stageStream(key: string, source: NodeJS.ReadableStream): Promise<{ bytes: number; token: string }>;
  /** 将 stageStream 的临时文件改为最终 key。 */
  commitStaged(key: string, token: string): Promise<void>;
  /** 删除 stageStream 留下的临时文件。 */
  discardStaged(key: string, token: string): Promise<void>;
  openReadStream(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 确保应用存储前缀目录存在（M1 创建应用时调用） */
  ensurePrefix(prefix: string): Promise<void>;
}

export const STORAGE = Symbol("STORAGE");
