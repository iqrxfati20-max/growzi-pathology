import { Router } from "express";
import db from "../db.js";

const router = Router();

router.get("/patients", (_req, res) => {
  const patients = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM patients r WHERE r.referred_by = p.referral_code) as referral_count,
        (SELECT COUNT(*) FROM tests t WHERE t.patient_id = p.id) as test_count
       FROM patients p
       ORDER BY p.created_at DESC`
    )
    .all();
  res.json({ patients });
});

router.get("/stats", (_req, res) => {
  const totalPatients = (db.prepare("SELECT COUNT(*) as count FROM patients").get() as { count: number }).count;
  const totalReferrals = (
    db.prepare("SELECT COUNT(*) as count FROM patients WHERE referred_by IS NOT NULL").get() as { count: number }
  ).count;
  const totalTests = (db.prepare("SELECT COUNT(*) as count FROM tests").get() as { count: number }).count;
  const totalPoints = (
    db.prepare("SELECT COALESCE(SUM(points), 0) as total FROM patients").get() as { total: number }
  ).total;

  res.json({ totalPatients, totalReferrals, totalTests, totalPoints });
});

router.post("/tests", (req, res) => {
  const { patient_id, test_name } = req.body as {
    patient_id?: number;
    test_name?: string;
  };

  if (!patient_id || !test_name) {
    res.status(400).json({ error: "patient_id and test_name are required" });
    return;
  }

  const patient = db
    .prepare("SELECT id FROM patients WHERE id = ?")
    .get(patient_id) as { id: number } | undefined;

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const addTest = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO tests (patient_id, test_name, points_awarded) VALUES (?, ?, 100)")
      .run(patient_id, test_name.trim());
    db.prepare("UPDATE patients SET points = points + 100 WHERE id = ?").run(patient_id);
    return result;
  });

  addTest();

  const updated = db
    .prepare("SELECT points FROM patients WHERE id = ?")
    .get(patient_id) as { points: number };

  res.status(201).json({ success: true, points_awarded: 100, new_total: updated.points });
});

router.delete("/patients/:id", (req, res) => {
  const patient = db
    .prepare("SELECT id FROM patients WHERE id = ?")
    .get(req.params["id"]) as { id: number } | undefined;

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  db.prepare("DELETE FROM tests WHERE patient_id = ?").run(req.params["id"]);
  db.prepare("DELETE FROM patients WHERE id = ?").run(req.params["id"]);

  res.json({ success: true });
});

export default router;
