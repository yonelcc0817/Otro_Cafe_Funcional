import express from "express";
import authMiddleware from "../middlewares/authMiddleware.js";
import authController from "../controllers/authController.js";

const { login, logout } = authController;
const router = express.Router();

router.post("/login", login);
router.post("/logout", authMiddleware(), logout);

export default router;
