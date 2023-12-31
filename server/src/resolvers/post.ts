import {
  Resolver,
  Query,
  Arg,
  Mutation,
  InputType,
  Field,
  Ctx,
  UseMiddleware,
  Int,
  FieldResolver,
  Root,
  ObjectType,
} from "type-graphql";
import { Post } from "../entities/Post";
import { MyContext } from "../types";
import { isAuth } from "../middleware/isAuth";
import { appDataSource } from "../";
import { Upvote } from "../entities/Upvote";
import { User } from "../entities/User";

@InputType()
class PostInput {
  @Field()
  title: string;
  @Field()
  text: string;
}

@ObjectType()
class PaginatedPosts {
  @Field(() => [Post])
  posts: Post[];
  @Field()
  hasMore: boolean;
}

@Resolver(Post)
export class PostResolver {
  @FieldResolver(() => String)
  textSnippet(@Root() post: Post) {
    return `${post.text.slice(0, 50)} ...`;
  }

  // Note: Utilizes Dataloader. Defined in createUserLoader.ts and put into Context in index.ts.
  // With Dataloader, when Home page renders with, say, 15 Posts via one query, this resolver
  // doesn't make 15 SQL queries, one for each Post creator (User). Instead makes 1 query for all Users.
  @FieldResolver(() => User)
  creator(@Root() post: Post, @Ctx() { userLoader }: MyContext) {
    return userLoader.load(post.creatorId);
  }

  @FieldResolver(() => Int, { nullable: true })
  async voteStatus(
    @Root() post: Post,
    @Ctx() { upvoteLoader, req }: MyContext
  ) {
    if (!req.session.userId) {
      return null;
    }

    const upvote = await upvoteLoader.load({
      postId: post.id,
      userId: req.session.userId,
    });

    return upvote ? upvote.value : null;
  }

  @Query(() => PaginatedPosts)
  async posts(
    @Arg("limit", () => Int) limit: number,
    @Arg("cursor", () => String, { nullable: true }) cursor: string | null
  ): Promise<PaginatedPosts> {
    const realLimit = Math.min(50, limit);
    const realLimitPlusOne = realLimit + 1;

    // NOTE: TypeORM Query Builder approach
    // let query = appDataSource.getRepository(Post).createQueryBuilder("post");

    // query = query
    //   .orderBy("post.createdAt", "DESC")
    //   .innerJoinAndSelect("post.creator", "creator")
    //   .select(["post", "creator"])
    //   .take(realLimitPlusOne);

    // if (cursor) {
    //   query = query.where("post.createdAt < :cursor", {
    //     cursor,
    //   });
    // }

    // const posts = await query.getMany();

    // NOTE: Alternative to TypeORM Query Builder approach, above

    const replacements: any[] = [realLimitPlusOne];

    if (cursor) {
      replacements.push(new Date(parseInt(cursor)));
    }

    const posts = await appDataSource.query(
      `
        select p.*
        from post p
        ${cursor ? `where p."createdAt" < $2` : ""}
        order by p."createdAt" DESC
        limit $1
      `,
      replacements
    );

    return {
      posts: posts.slice(0, realLimit),
      hasMore: posts.length === realLimitPlusOne,
    };
  }

  @Query(() => Post, { nullable: true })
  post(@Arg("id", () => Int) id: number): Promise<Post | null> {
    return Post.findOne({ where: { id } });
  }

  @Mutation(() => Post)
  @UseMiddleware(isAuth)
  async createPost(
    @Arg("input") input: PostInput,
    @Ctx() { req }: MyContext
  ): Promise<Post> {
    return Post.create({
      ...input,
      creatorId: req.session.userId,
    }).save();
  }

  @Mutation(() => Post, { nullable: true })
  @UseMiddleware(isAuth)
  async updatePost(
    @Arg("id", () => Int) id: number,
    @Arg("title") title: string,
    @Arg("text") text: string,
    @Ctx() { req }: MyContext
  ): Promise<Post | null> {
    const result = await appDataSource
      .createQueryBuilder()
      .update(Post)
      .set({ title, text })
      .where('id = :id and "creatorId" = :creatorId', {
        id,
        creatorId: req.session.userId,
      })
      .returning("*")
      .execute();

    return result.raw[0];
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async deletePost(
    @Arg("id", () => Int) id: number,
    @Ctx() { req }: MyContext
  ): Promise<boolean> {
    // NOTE: Deleting Upvote from Post (non-cascading approach)
    // const post = await Post.findOneBy({ id });
    // if (!post) {
    //   return false;
    // }
    // if (post.creatorId !== req.session.userId) {
    //   throw new Error("Not authorized");
    // }
    // await Upvote.delete({ postId: id });
    // await Post.delete({ id });

    // NOTE: Deleting Upvote from Post
    // Leveraging cascading option on post field of Upvote entity
    await Post.delete({ id, creatorId: req.session.userId });
    return true;
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async vote(
    @Arg("postId", () => Int) postId: number,
    @Arg("value", () => Int) value: number,
    @Ctx() { req }: MyContext
  ) {
    const isUpvote = value !== -1;
    const realValue = isUpvote ? 1 : -1;
    const { userId } = req.session;

    const vote = await Upvote.findOne({ where: { postId, userId } });

    // the user has voted on the post before
    if (vote && vote.value !== realValue) {
      await appDataSource.transaction(async (tm) => {
        await tm.query(
          `
            update upvote
            set value = $1
            where "postId" = $2 and "userId" = $3
          `,
          [realValue, postId, userId]
        );
        await tm.query(
          `
            update post
            set points = points + $1
            where id = $2
          `,
          [realValue * 2, postId]
        );
      });

      // has never voted on post before
    } else if (!vote) {
      await appDataSource.transaction(async (tm) => {
        await tm.query(
          `
            insert into upvote ("userId", "postId", value)
            values ($1, $2, $3);
          `,
          [userId, postId, realValue]
        );
        await tm.query(
          `
            update post
            set points = points + $1
            where id = $2
          `,
          [realValue, postId]
        );
      });
    }

    return true;
  }
}
