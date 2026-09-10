import { Router } from "express";
import { healthRouter } from "./health";
import { vodRouter } from "./vod";
import { candidatesRouter } from "./candidates";
import { compositionsRouter } from "./compositions";
import { effectsLibraryRouter } from "./effectsLibrary";

export const routes = Router();

routes.use(healthRouter);
routes.use(vodRouter);
routes.use(candidatesRouter);
routes.use(compositionsRouter);
routes.use(effectsLibraryRouter);
