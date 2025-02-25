import express, { Application, Request, Response, NextFunction} from "express";
import {complete} from './lib/complete';
const key = process.env.KEY || "";
import { MongoClient } from 'mongodb';
require('dotenv').config();


const uri = process.env.URL || "";

let dbConnection: any;
const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  } as any
);

client.connect((err: any) => {
  dbConnection = client.db("DavinciLogs");
  if (err) console.log(err);
});

export default (app: Application) => {
  app.get(
    "/",
    async (req: Request, res: Response): Promise<Response> => {
      return res.status(200).send({
        message: "Hello from Davinci",
      });
    }
  );

  app.post(
    "/complete",
    async (req: Request, res: Response): Promise<Response> => {
      const {prompt, language} = req.body;
      console.log(prompt, language);

      const suggestions = await complete(prompt, language, key);

      return res.status(200).json({
        suggestions: suggestions,
      })
    }
  )

  app.post(
    "/debug",
    async(req: Request, res: Response): Promise<Response> => {
      console.log("/debug: \n", req.body, "\n")
      return res.status(200).send({
        message: "debug printed",
      });
    }
  )


  app.get(
    "/logs",
    async (req: Request, res: Response): Promise<any> => {
      dbConnection
        .collection("logs")
        .find({})
        .limit(100)
        .toArray((err: any, result: any) => {
          if (err) console.log(err);
          res.json(result);
        })
    }
  )

  app.post(
    "/document",
    async(req: Request, res: Response): Promise<any> => {
      if (!dbConnection) return res.status(400).send({message: "Failed to Connect to DB"});

      const {document, timeStamp, sessionId} = req.body;

      dbConnection
        .collection("documents")
        .insertOne({
          sessionId: sessionId,
          document: document,
          timeStamp: timeStamp
        }, (err: any) => {
          if(err){
            res.status(500).send({message: "failed to add document"})
            return;
          }
        })

      res.status(201).send({message: "Success!"})
    }
  )

  app.get(
    "/document/:sessionId/last",
    async (req: Request, res: Response): Promise<any> => {
      const {sessionId} = req.params;
      if (!dbConnection) return res.status(500).send({message: "Failed to connect to db"});

      const documents = dbConnection.collection("documents");

      const lastDocument = await documents
        .find({sessionId: sessionId})
        .sort({timeStamp: -1})
        .limit(1)
        .toArray();

      console.log(lastDocument);

      if (!lastDocument[0]) {
        res.status(200).json(null);
        return;
      }
      res.status(200).json(lastDocument[0]);
    }
  )

  // get logs by sessionId,
  app.get(
    "/logs/session/:sessionId",
    async (req: Request, res: Response): Promise<any> => {
      if (!dbConnection) return res.status(500).send({message: "Failed to Connect to DB"});

      const {sessionId} = req.params;

      const logs = dbConnection.collection("logs");

      logs
        .find({sessionId: sessionId})
        .limit(100)
        .toArray((err: any, result: any) => {
          if(err) console.log(err);     
          res.json(result);
        });

    }
  )

  app.get(
    "/session/:sessionId",
    async (req: Request, res:Response): Promise<any> => {
      if (!dbConnection) return res.status(500).send({message: "Failed to Connect to DB"});

      const {sessionId} = req.params;
      console.log("sessionId");

      const sessions = dbConnection.collection("sessions");

      const [session] = await sessions
                        .find({sessionId: sessionId})
                        .limit(1)
                        .toArray();

      if (!session) res.status(401).send({message: `No Session with Id ${sessionId}`})

      res.status(200).json({session: session});
    }
  );

  app.post(
    "/logs",
    async (req: Request, res: Response): Promise<Response> => {
      console.log("/logs", req.body);

      if(!dbConnection) return res.status(400).send({message: "Failed to Connect to DB"});

      dbConnection
        .collection("logs")
        .insertOne(req.body, (err: any) => {
          if(err) return res.status(400).send({message: 'Failed to Log'});
        })
    
      return res.status(201).send({
        message: "Log Went Through Successfully"
      })
    }
  )

  app.get(
    "/session",
    async (req: Request, res: Response): Promise<any> => {
      if (!dbConnection) return res.status(400).send({message: "Failed to Connect to DB"});

      const sessions = dbConnection.collection("sessions");

      sessions
        .find({})
        .limit(12)
        .sort({latestPing: -1})
        .toArray((err: any, result: any) => {
          if (err) console.log(err);
          res.json(result);
        })
    }
  )

  app.get(
    "/session/user/:userId",
    async (req: Request, res: Response): Promise<any> => {
      if (!dbConnection) return res.status(400).send({message: "Failed to Connect to DB"});

      const {userId} = req.params;

      const users = dbConnection.collection("users");
      const sessions = dbConnection.collection("sessions");

      const [user] = await users
                    .find({userId: userId})
                    .toArray();

      const userSessionIds = user?.sessions;

      if (!userSessionIds || userSessionIds.length == 0) 
        return res.status(400).send({message: "User has no sessions"});

      let userSessions: any = [];

      await Promise.all(
        userSessionIds.map(async (sessionId: string) => {
          let [ session ] = await sessions
                          .find({sessionId: sessionId})
                          .toArray();
          userSessions.push(session);
        })
      )

      res.json(userSessions);
    }
  )


  // ping a session to keep it alive
  app.post(
    "/session/ping",
    async (req: Request, res: Response): Promise<Response> => {

      const {sessionId} = req.body;

      if(!dbConnection) return res.status(400).send({message: "Failed to Connect to DB"});

      const sessions = await dbConnection.collection("sessions");

      const session = await sessions
                        .find({sessionId: sessionId})
                        .limit(1)
                        .toArray();

      if(session.length === 0){
        sessions
          .insertOne({          
            sessionId: req.body.sessionId,
            startTime: new Date(),
            latestPing: new Date(),
          })

        return res.status(201).send({message: "Created Session"});
      }

      sessions.updateOne({sessionId: sessionId}, {
        $set: {
          ...session[0],
          latestPing: new Date(),
        }
      }, (err: any) => {
          if (err) console.log(err);
      });

      return res.status(201).send({message: "Pinged Session"})
    }
  )

  app.get(
    "/user",
    async (req: Request, res: Response): Promise<any> => {
      if(!dbConnection) res.status(500).send({message: "Not connected to db"});

      const users = dbConnection.collection("users");


      await users
        .find({})
        .limit(100)
        .toArray((err: any, result: any) => {
          res.json(result);
        });
    }
  )

  app.post(
    "/user/create",
    async (req: Request, res: Response): Promise<any> => {
      console.log("/user/create", req.body);

      const {userId, activated} = req.body;

      if(!dbConnection) res.status(400).send({message: "Not connected to db"});

      if(!userId) res.status(400).send({message: "No UserId in request"});

      const users = await dbConnection.collection("users");

      await users
        .insertOne({
          userId: userId,
          activated,
          sessions: [],
        }, (err: any) => {
        if (err) {
              res.status(400).send({message: "Failed to create User"});
              console.log(err);
        } 
      })

    }
  )


  app.post(
    "/user/session",
    async (req: Request, res: Response): Promise<any> => {
      console.log("/user/session invoked \n");
      const {userId, sessionId} = req.body;

      if (!dbConnection) return res.status(400).send({message: "Failed to Connect to DB"});

      const users = dbConnection.collection("users");

      const user = await users.find({userId: userId}).limit(1).toArray();

      console.log("/user/session, user: ", user[0]);
      console.log("user/session, sessions: ", user[0].sessions);

      if (!user[0]) return;

      console.log('server before');

      await users
        .updateOne({userId: userId}, {
          $set: {
            userId: userId,
            activated: user[0].activated || true,
            sessions: user[0].sessions.length > 0 ? [... user[0].sessions, sessionId] : [sessionId],
          }
        }, (err: any, res:any) => {
            if(err) throw err 
            if (res) console.log(res);
        });
      console.log('after');

      res.status(201).send({message: 'Success'});
    }
  )



}
