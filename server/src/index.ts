import express from "express";
import dotenv from "dotenv";
import http from "http";
import cors from "cors";
import { json } from "body-parser";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@apollo/server/express4";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { getSession } from "next-auth/react";
import { PrismaClient } from "@prisma/client";
import { PubSub } from "graphql-subscriptions";
import resolvers from "./graphql/resolvers";
import typeDefs from "./graphql/typeDefs";
import { GraphQLContext, Session, SubscriptionContext } from "./utils/types";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";

async function startApolloServer() {
    dotenv.config();
    const app = express();
    const httpServer = http.createServer(app);

    // Creating the WebSocket server
    const wsServer = new WebSocketServer({
        // This is the `httpServer` we created in a previous step.
        server: httpServer,
        // Pass a different path here if app.use
        // serves expressMiddleware at a different path
        path: "/graphql/subscriptions",
    });

    const schema = makeExecutableSchema({
        typeDefs,
        resolvers,
    });

    /*
    Context Parameter
    */
    const prisma = new PrismaClient();
    const pubsub = new PubSub();

    // Hand in the schema we just created and have the
    // WebSocketServer start listening.
    const serverCleanup = useServer(
        {
            schema,
            context: async (ctx: SubscriptionContext) => {
                if (ctx.connectionParams && ctx.connectionParams.session) {
                    console.log("SERVER CONTEXT", ctx.connectionParams);
                    const { session } = ctx.connectionParams;
                    return { session, prisma, pubsub };
                }
                return { session: null, prisma, pubsub };
            },
        },
        wsServer
    );

    const server = new ApolloServer({
        schema,
        csrfPrevention: true,
        plugins: [
            // Proper shutdown for the HTTP server.
            ApolloServerPluginDrainHttpServer({ httpServer }),

            // Proper shutdown for the WebSocket server.
            {
                async serverWillStart() {
                    return {
                        async drainServer() {
                            await serverCleanup.dispose();
                        },
                    };
                },
            },
        ],
    });

    await server.start();

    const corsOptions = {
        origin: process.env.CLIENT_ORIGIN,
        credentials: true,
    };

    app.use(
        "/graphql",
        cors<cors.CorsRequest>(corsOptions),
        json(),
        expressMiddleware(server, {
            context: async ({ req }): Promise<GraphQLContext> => {
                const session = await getSession({ req });

                return { session: session as Session, prisma, pubsub };
            },
        })
    );

    const PORT = 4000;

    await new Promise<void>((resolve) =>
        httpServer.listen({ port: PORT }, resolve)
    );
    console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
}

startApolloServer().catch((err) => console.log(err));
