import { Router } from "express";
import db from "../db.js";

const router = Router();

function generateReferralCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const suffix = Math.floor(1000 + Math.random() * 9000).toString();
  return `${prefix}${suffix}`;
}

router.post("/register", (req, res) => {
  const { name, mobile, referral_code_used } = req.body as {
    name?: string;
    mobile?: string;
    referral_code_used?: string;
  };

  if (!name || !mobile) {
    res.status(400).json({ error: "Name and mobile are required" });
    return;
  }

  const cleanMobile = mobile.replace(/\D/g, "");
  if (cleanMobile.length < 10) {
    res.status(400).json({ error: "Invalid mobile number" });
    return;
  }

  const existing = db.prepare("SELECT * FROM patients WHERE mobile = ?").get(cleanMobile) as
    | { id: number; mobile: string }
    | undefined;
  if (existing) {
    res.status(409).json({ error: "Mobile number already registered" });
    return;
  }

  let referralCode = generateReferralCode(name);
  while (db.prepare("SELECT id FROM patients WHERE referral_code = ?").get(referralCode)) {
    referralCode = generateReferralCode(name);
  }

  let referrerId: number | null = null;

  if (referral_code_used) {
    const referrer = db
      .prepare("SELECT id FROM patients WHERE referral_code = ?")
      .get(referral_code_used.toUpperCase()) as { id: number } | undefined;
    if (referrer) {
      referrerId = referrer.id;
    }
  }

  const insert = db.transaction(() => {
    const result = db
      .prepare(
        "INSERT INTO patients (name, mobile, referral_code, referred_by) VALUES (?, ?, ?, ?)"
      )
      .run(name.trim(), cleanMobile, referralCode, referral_code_used?.toUpperCase() || null);

    if (referrerId) {
      db.prepare("UPDATE patients SET points = points + 50 WHERE id = ?").run(referrerId);
    }

    return result;
  });

  const result = insert();

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ?")
    .get(result.lastInsertRowid) as PatientRow;

  res.status(201).json(toPatientResponse(patient));
});

router.get("/lookup", (req, res) => {
  const { mobile } = req.query as { mobile?: string };
  if (!mobile) {
    res.status(400).json({ error: "Mobile is required" });
    return;
  }
  const cleanMobile = (mobile as string).replace(/\D/g, "");
  const patient = db
    .prepare("SELECT * FROM patients WHERE mobile = ?")
    .get(cleanMobile) as PatientRow | undefined;

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.json(toPatientResponse(patient));
});

router.get("/:id/referrals", (req, res) => {
  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ?")
    .get(req.params["id"]) as PatientRow | undefined;

  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }

  const referrals = db
    .prepare(
      "SELECT id, name, mobile, created_at FROM patients WHERE referred_by = ? ORDER BY created_at DESC"
    )
    .all(patient.referral_code) as { id: number; name: string; mobile: string; created_at: string }[];

  res.json({ referrals });
});

router.get("/:id/tests", (req, res) => {
  const tests = db
    .prepare("SELECT * FROM tests WHERE patient_id = ? ORDER BY created_at DESC")
    .all(req.params["id"]) as TestRow[];
  res.json({ tests });
});

interface PatientRow {
  id: number;
  name: string;
  mobile: string;
  referral_code: string;
  referred_by: string | null;
  points: number;
  created_at: string;
}

interface TestRow {
  id: number;
  patient_id: number;
  test_name: string;
  points_awarded: number;
  created_at: string;
}

function toPatientResponse(p: PatientRow) {
  return {
    id: p.id,
    name: p.name,
    mobile: p.mobile,
    referral_code: p.referral_code,
    referred_by: p.referred_by,
    points: p.points,
    created_at: p.created_at,
  };
}

export default router;
