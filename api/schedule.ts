import * as cheerio from "cheerio";

const SIBUPK_STUDENT_URL = "http://old.sibupk.su/services/shedule_new/index.php?mode=1";
const SIBUPK_TEACHER_URL = "http://old.sibupk.su/services/shedule_new/index.php?mode=2";

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const urlPath = req.url || "";

  // Handle Teachers List API: /api/teachers
  if (urlPath.includes("/teachers") && req.method === "GET") {
    try {
      const resp = await fetch(SIBUPK_TEACHER_URL, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": SIBUPK_TEACHER_URL,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const html = await resp.text();
      const $ = cheerio.load(html);

      const departments: { id: string; name: string }[] = [];
      $('select[name="id_KodKaf"] option').each((_, el) => {
        const val = $(el).attr("value");
        const name = $(el).text().trim();
        if (val) departments.push({ id: val, name });
      });

      const teachers: { fio: string; id_KodKaf: string; departmentName: string }[] = [];
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

      return res.status(200).json({ success: true, departments, teachers });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // Handle Teacher Schedule API: /api/teacher-schedule
  if (urlPath.includes("/teacher-schedule") && req.method === "POST") {
    try {
      const { id_KodKaf, FIO, RangeNedel } = req.body || {};
      if (!FIO) {
        return res.status(400).json({ success: false, error: "Не указано ФИО преподавателя" });
      }

      const params = new URLSearchParams();
      params.append("FIO", String(FIO));
      if (id_KodKaf) params.append("id_KodKaf", String(id_KodKaf));
      if (RangeNedel) params.append("RangeNedel", String(RangeNedel));

      const resp = await fetch(SIBUPK_TEACHER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": SIBUPK_TEACHER_URL,
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const responseText = await resp.text();
      const $ = cheerio.load(responseText);

      const weeks: { value: string; label: string }[] = [];
      $('select[name="RangeNedel"] option').each((_, el) => {
        const val = $(el).attr("value");
        const label = $(el).text().trim();
        if (val !== undefined && val !== "") {
          weeks.push({ value: val, label });
        }
      });

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
            const stream = $(tds[2]).text().trim();
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

      return res.status(200).json({
        success: true,
        options: { weeks },
        schedule,
        teacher: { fio: FIO, id_KodKaf },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // Handle Student Schedule API (default)
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { id_Forma, id_Fak, Kurs, NamePodGrup, RangeNedel } = req.body || {};

    const params = new URLSearchParams();
    if (id_Forma) params.append("id_Forma", String(id_Forma));
    if (id_Fak) params.append("id_Fak", String(id_Fak));
    if (Kurs) params.append("Kurs", String(Kurs));
    if (NamePodGrup) params.append("NamePodGrup", String(NamePodGrup));
    if (RangeNedel) params.append("RangeNedel", String(RangeNedel));

    let responseText = "";
    try {
      const fetchRes = await fetch(SIBUPK_STUDENT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": SIBUPK_STUDENT_URL,
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      });

      if (!fetchRes.ok) {
        throw new Error(`Server returned status ${fetchRes.status}`);
      }
      responseText = await fetchRes.text();
    } catch (err: any) {
      console.error("Fetch network error:", err.message);
      return res.status(502).json({
        error: "Не удалось подключиться к сайту СибУПК. Пожалуйста, попробуйте позже.",
        details: err.message,
      });
    }

    const $ = cheerio.load(responseText);

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

    const forms = extractOptions("id_Forma");
    const faculties = extractOptions("id_Fak");
    const courses = extractOptions("Kurs");
    const groups = extractOptions("NamePodGrup");
    const weeks = extractOptions("RangeNedel");

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

    return res.status(200).json({
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
    console.error("Vercel Serverless Function error:", error);
    return res.status(500).json({
      error: "Произошла внутренняя ошибка сервера при обработке расписания.",
      details: error.message,
    });
  }
}
