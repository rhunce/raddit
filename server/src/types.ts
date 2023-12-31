import { Request, Response } from "express";
import { Session } from "express-session";
import { Redis } from "ioredis";
import { createUserLoader } from "./utils/createUserLoader";
import { createUpvoteLoader } from "./utils/createUpvoteLoader";

export type MyContext = {
  req: Request & { session: Session & { userId: number } };
  res: Response;
  redis: Redis;
  // userLoader: DataLoader<number, User, number>;
  // Note: Alternative way of getting type
  userLoader: ReturnType<typeof createUserLoader>;
  upvoteLoader: ReturnType<typeof createUpvoteLoader>;
};
