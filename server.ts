import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";

// Native fetch is available in Node 18+ which matches our runtime env
const SIBUPK_STUDENT_URL = "http://old.sibupk.su/services/shedule_new/index.php?mode=1";
const SIBUPK_TEACHER_URL = "http://old.sibupk.su/services/shedule_new/index.php?mode=2";

interface IndexedGroup {
  id_Forma: string;
  formaLabel: string;
  id_Fak: string;
  fakLabel: string;
  Kurs: string;
  kursLabel?: string;
  NamePodGrup: string;
  groupLabel: string;
  shortName: string;
}

let cachedGroups: IndexedGroup[] = [];
try {
  const groupsPath = path.join(process.cwd(), "src", "data", "groups.json");
  if (fs.existsSync(groupsPath)) {
    cachedGroups = JSON.parse(fs.readFileSync(groupsPath, "utf-8"));
  }
} catch (e) {
  console.warn("Could not load groups.json cache:", e);
}

interface TeacherInfo {
  fio: string;
  id_KodKaf: string;
  departmentName: string;
}

interface DepartmentInfo {
  id: string;
  name: string;
}

// In-memory caches with 2-hour TTL
let cachedTeachers: TeacherInfo[] | null = null;
let cachedDepartments: DepartmentInfo[] | null = null;
let cachedTeachersTime = 0;
let isFetchingTeachers = false;

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

async function postSibupk(url: string, params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": url,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Server returned status ${res.status}`);
  }
  return res.text();
}

async function fetchAllTeachers(): Promise<{ departments: DepartmentInfo[]; teachers: TeacherInfo[] }> {
  if (cachedTeachers && cachedDepartments && Date.now() - cachedTeachersTime < CACHE_TTL_MS) {
    return { departments: cachedDepartments, teachers: cachedTeachers };
  }
  if (isFetchingTeachers && cachedTeachers && cachedDepartments) {
    return { departments: cachedDepartments, teachers: cachedTeachers };
  }

  isFetchingTeachers = true;
  try {
    const res = await fetch(SIBUPK_TEACHER_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": SIBUPK_TEACHER_URL,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const departments: DepartmentInfo[] = [];
    $('select[name="id_KodKaf"] option').each((_, el) => {
      const val = $(el).attr("value");
      const name = $(el).text().trim();
      if (val) departments.push({ id: val, name });
    });

    const teachers: TeacherInfo[] = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes("mode=2") && href.includes("FIO=")) {
        const fio = $(el).text().trim();
        const match = href.match(/id_KodKaf=(\d+)/);
        const id_KodKaf = match ? match[1] : "";
        const dept = departments.find((d) => d.id === id_KodKaf);
        teachers.push({
          fio,
          id_KodKaf,
          departmentName: dept?.name || "Кафедра не указана",
        });
      }
    });

    if (teachers.length > 0) {
      cachedTeachers = teachers;
      cachedDepartments = departments;
      cachedTeachersTime = Date.now();
      console.log(`[Cache] Successfully indexed ${teachers.length} teachers across ${departments.length} departments.`);
    }

    return {
      departments: cachedDepartments || departments,
      teachers: cachedTeachers || teachers,
    };
  } finally {
    isFetchingTeachers = false;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API: Get indexed student groups for instant fast search
  app.get("/api/groups", (req, res) => {
    res.json({ success: true, count: cachedGroups.length, groups: cachedGroups });
  });

  // API: Get indexed teachers and departments for instant search
  app.get("/api/teachers", async (req, res) => {
    try {
      const data = await fetchAllTeachers();
      res.json({ success: true, ...data });
    } catch (err: any) {
      console.error("Error in /api/teachers:", err.message);
      res.status(500).json({ success: false, error: "Не удалось получить список преподавателей: " + err.message });
    }
  });

  // API: Get teacher schedule
  app.post("/api/teacher-schedule", async (req, res) => {
    try {
      const { id_KodKaf, FIO, RangeNedel } = req.body;
      if (!FIO) {
        return res.status(400).json({ success: false, error: "Не указано ФИО преподавателя" });
      }

      const params: Record<string, string> = {
        FIO: String(FIO),
      };
      if (id_KodKaf) params.id_KodKaf = String(id_KodKaf);
      if (RangeNedel) params.RangeNedel = String(RangeNedel);

      let responseText = "";
      try {
        responseText = await postSibupk(SIBUPK_TEACHER_URL, params);
      } catch (fetchErr: any) {
        return res.status(502).json({
          success: false,
          error: "Не удалось подключиться к сайту СибУПК. Пожалуйста, попробуйте позже.",
          details: fetchErr.message,
        });
      }

      const $ = cheerio.load(responseText);

      // Extract available weeks
      const weeks: { value: string; label: string }[] = [];
      $('select[name="RangeNedel"] option').each((_, el) => {
        const val = $(el).attr("value");
        const label = $(el).text().trim();
        if (val !== undefined && val !== "") {
          weeks.push({ value: val, label });
        }
      });

      // Parse schedule table (teacher layout has 4 columns: lessonNumber, subject, stream, classroom)
      const schedule: any[] = [];
      let currentDay = "";
      let currentDate = "";
      let currentWeekType = "";

      const scheduleTable = $("table").filter((_, el) => {
        const text = $(el).text();
        return text.includes("№ Пары") && text.includes("Дисциплина");
      });

      if (scheduleTable.length > 0) {
        scheduleTable.find("tr").each((_, row) => {
          const ths = $(row).find("th");
          const tds = $(row).find("td");

          if (ths.length > 0) {
            const thText = ths.text().trim();
            if (thText.includes("НЕДЕЛЯ")) {
              currentWeekType = thText.replace(/\s+/g, " ");
            } else {
              const match = thText.match(/([А-Яа-яA-Za-z]+)\s*\((\d{2}\.\d{2}\.\d{4})\)/);
              if (match) {
                currentDay = match[1];
                currentDate = match[2];
              } else {
                currentDay = thText;
                currentDate = "";
              }
            }
          } else if (tds.length >= 4 && currentDate) {
            const lessonText = $(tds[0]).text().trim();
            const subject = $(tds[1]).text().trim();
            if (!subject || subject.includes("ПРЕПОДАВАТЕЛЯМ")) return;
            const stream = $(tds[2]).text().trim(); // Groups that the teacher teaches
            const classroom = $(tds[3]).text().trim();

            const lessonMatch = lessonText.match(/^(\d+)(?:\s*\((.*)\))?$/);
            const lessonNumber = lessonMatch ? parseInt(lessonMatch[1], 10) : (parseInt(lessonText, 10) || 1);
            const lessonTime = lessonMatch && lessonMatch[2] ? lessonMatch[2].trim() : "";

            schedule.push({
              weekType: currentWeekType,
              dayName: currentDay,
              date: currentDate,
              lessonNumber,
              time: lessonTime,
              subject,
              stream,
              classroom,
              teacher: FIO,
            });
          }
        });
      }

      res.json({
        success: true,
        options: {
          weeks,
        },
        schedule,
        teacher: {
          fio: FIO,
          id_KodKaf,
        },
      });
    } catch (err: any) {
      console.error("Backend teacher schedule error:", err);
      res.status(500).json({
        success: false,
        error: "Произошла внутренняя ошибка сервера при обработке расписания преподавателя.",
        details: err.message,
      });
    }
  });

  // API router to fetch student schedules & options
  app.post("/api/schedule", async (req, res) => {
    try {
      const { id_Forma, id_Fak, Kurs, NamePodGrup, RangeNedel } = req.body;

      const params: Record<string, string> = {};
      if (id_Forma) params.id_Forma = String(id_Forma);
      if (id_Fak) params.id_Fak = String(id_Fak);
      if (Kurs) params.Kurs = String(Kurs);
      if (NamePodGrup) params.NamePodGrup = String(NamePodGrup);
      if (RangeNedel) params.RangeNedel = String(RangeNedel);

      let responseText = "";
      try {
        responseText = await postSibupk(SIBUPK_STUDENT_URL, params);
      } catch (err: any) {
        console.error("Fetch network error:", err.message);
        return res.status(502).json({
          error: "Не удалось подключиться к сайту СибУПК. Пожалуйста, попробуйте позже.",
          details: err.message,
        });
      }

      const $ = cheerio.load(responseText);

      // Helper to extract dropdown options
      const extractOptions = (selectName: string) => {
        const options: { value: string; label: string }[] = [];
        $(`select[name="${selectName}"] option`).each((_, el) => {
          const val = $(el).attr("value");
          const label = $(el).text().trim();
          if (val !== undefined && val !== "") {
            options.push({ value: val, label });
          }
        });
        return options;
      };

      // Extract whatever options are currently active in this step's HTML response
      const forms = extractOptions("id_Forma");
      const faculties = extractOptions("id_Fak");
      const courses = extractOptions("Kurs");
      const groups = extractOptions("NamePodGrup");
      const weeks = extractOptions("RangeNedel");

      // Parse schedule table if present
      const schedule: any[] = [];
      let currentDay = "";
      let currentDate = "";
      let currentWeekType = "";

      const scheduleTable = $("table").filter((_, el) => {
        const text = $(el).text();
        return text.includes("№ Пары") && text.includes("Дисциплина");
      });

      if (scheduleTable.length > 0) {
        scheduleTable.find("tr").each((_, row) => {
          const ths = $(row).find("th");
          const tds = $(row).find("td");

          if (ths.length > 0) {
            const thText = ths.text().trim();
            if (thText.includes("НЕДЕЛЯ")) {
              currentWeekType = thText.replace(/\s+/g, " ");
            } else {
              const match = thText.match(/([А-Яа-яA-Za-z]+)\s*\((\d{2}\.\d{2}\.\d{4})\)/);
              if (match) {
                currentDay = match[1];
                currentDate = match[2];
              } else {
                currentDay = thText;
                currentDate = "";
              }
            }
          } else if (tds.length === 5) {
            const lessonText = $(tds[0]).text().trim();
            const subject = $(tds[1]).text().trim();
            const stream = $(tds[2]).text().trim();
            const classroom = $(tds[3]).text().trim();
            const teacher = $(tds[4]).text().trim();

            const lessonMatch = lessonText.match(/^(\d+)(?:\s*\((.*)\))?$/);
            const lessonNumber = lessonMatch ? parseInt(lessonMatch[1], 10) : (parseInt(lessonText, 10) || 1);
            const lessonTime = lessonMatch && lessonMatch[2] ? lessonMatch[2].trim() : "";

            schedule.push({
              weekType: currentWeekType,
              dayName: currentDay,
              date: currentDate,
              lessonNumber,
              time: lessonTime,
              subject,
              stream,
              classroom,
              teacher,
            });
          }
        });
      }

      // Return options, current selections, and parsed schedule (if loaded)
      res.json({
        success: true,
        options: {
          forms,
          faculties,
          courses,
          groups,
          weeks,
        },
        schedule,
        debug: {
          receivedParams: { id_Forma, id_Fak, Kurs, NamePodGrup, RangeNedel },
          hasTable: scheduleTable.length > 0,
          scheduleLength: schedule.length,
        },
      });
    } catch (error: any) {
      console.error("Backend proxy error:", error);
      res.status(500).json({
        error: "Произошла внутренняя ошибка сервера при обработке расписания.",
        details: error.message,
      });
    }
  });

  // Serve Vite frontend
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    // Background warmup for teachers cache (single request)
    fetchAllTeachers().catch((err) => console.warn("Background teachers cache warmup error:", err.message));
  });
}

startServer();
