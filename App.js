import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  Platform,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as MailComposer from "expo-mail-composer";

const STORAGE_KEYS = {
  settings: "slc_settings_v3",
  jobs: "slc_jobs_v3",
};

const SUBURB_ORDER = [
  "Naenae","Taita","Avalon","Epuni","Waiwhetu","Waterloo","Hutt Central","Woburn","Boulcott",
  "Petone","Alicetown","Moera","Korokoro","Belmont","Normandale","Maungaraki","Wainuiomata","Eastbourne",
  "Trentham","Heretaunga","Silverstream","Wallaceville","Totara Park","Birchville",
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function money(n) {
  const x = Number.isFinite(n) ? n : 0;
  return `$${x.toFixed(2)}`;
}
function clampNumberText(t) {
  const cleaned = String(t ?? "").replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 2) return cleaned;
  return parts[0] + "." + parts.slice(1).join("");
}
function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function nextRepeatISO(iso, repeat) {
  if (repeat === "weekly") return addDaysISO(iso, 7);
  if (repeat === "fortnightly") return addDaysISO(iso, 14);
  if (repeat === "4weeks") return addDaysISO(iso, 28);
  return null;
}
function suburbRank(suburb) {
  const idx = SUBURB_ORDER.findIndex((x) => x.toLowerCase() === String(suburb || "").toLowerCase());
  return idx === -1 ? 999 : idx;
}
function buildGoogleMapsMultiStopUrl(addresses, startSuburb) {
  const origin = encodeURIComponent(startSuburb || "Naenae");
  const destination = encodeURIComponent(addresses[addresses.length - 1] || startSuburb || "Naenae");
  const waypoints = addresses.slice(0, -1).map(a => encodeURIComponent(a)).join("|");
  const wp = waypoints ? `&waypoints=${waypoints}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wp}&travelmode=driving`;
}
function jobCosts(job, s) {
  const fuel = (Number(job.km) || 0) * (Number(s.fuel_cost_per_km) || 0);
  const dump = job.useDump ? (Number(job.dumpFee) || 0) : 0;
  const mats = job.useMaterials ? (Number(job.materialsCost) || 0) : 0;
  const other = Number(job.otherCost) || 0;
  return fuel + dump + mats + other;
}

const DEFAULT_SETTINGS = {
  // Fortnightly midpoints from your flyer
  small_mid: 32.5,
  med_mid: 42.5,
  large_mid: 55.0,
  xl_mid: 80.0,

  monthly_mult: 1.30, // 4-weekly uplift
  oneoff_mult: 1.15,  // one-off uplift on monthly

  extra_weeds: 20,
  extra_hedge: 20,
  extra_waste: 20,

  gst_enabled: false,
  gst_pct: 15,

  fuel_cost_per_km: 0.0,
  dump_fee_default: 0.0,
  materials_default: 0.0,

  start_suburb: "Naenae",
  from_email: "info@straightforwardlawncare.co.nz",
};

function priceBandFortnightly(areaM2, s) {
  const m2 = Number(areaM2) || 0;
  if (m2 <= 300) return { band: "Small (0–300 m²)", base: s.small_mid };
  if (m2 <= 600) return { band: "Medium (300–600 m²)", base: s.med_mid };
  if (m2 <= 900) return { band: "Large (600–900 m²)", base: s.large_mid };
  return { band: "XL (900+ m²)", base: s.xl_mid };
}

function calcPricing(areaM2, frequency, extras, s) {
  const band = priceBandFortnightly(areaM2, s);
  const fortnightly = band.base;
  const monthly = fortnightly * (s.monthly_mult || 1);
  const oneoff = monthly * (s.oneoff_mult || 1);

  let base = fortnightly;
  if (frequency === "4weeks") base = monthly;
  if (frequency === "oneoff") base = oneoff;

  const extrasTotal =
    (extras.weeds ? s.extra_weeds : 0) +
    (extras.hedge ? s.extra_hedge : 0) +
    (extras.waste ? s.extra_waste : 0);

  const exGst = base + extrasTotal;
  const gst = s.gst_enabled ? exGst * ((s.gst_pct || 0) / 100) : 0;
  const incGst = exGst + gst;

  return { bandLabel: band.band, fortnightly, monthly, oneoff, baseChosen: base, extrasTotal, exGst, gst, incGst };
}

const TabButton = ({ active, label, onPress }) => (
  <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </Pressable>
);

function Card({ title, children, right }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {right ? <View>{right}</View> : null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function Line({ label, value }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

function BigTotal({ label, value }) {
  return (
    <View style={styles.bigTotal}>
      <Text style={styles.bigLabel}>{label}</Text>
      <Text style={styles.bigValue}>{value}</Text>
    </View>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <Pressable style={styles.toggle} onPress={() => onChange(!value)}>
      <View style={[styles.checkbox, value && styles.checkboxOn]} />
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, keyboardType = "default", placeholder = "" }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        placeholder={placeholder}
        placeholderTextColor="#6b7280"
        onChangeText={onChangeText}
        style={styles.input}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function NumberField({ label, value, onChangeNumber, placeholder = "0" }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={String(value)}
        placeholder={placeholder}
        placeholderTextColor="#6b7280"
        onChangeText={(t) => onChangeNumber(clampNumberText(t))}
        style={styles.input}
        keyboardType="numeric"
      />
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState("Today");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [jobs, setJobs] = useState([]);

  // New Job
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("Naenae");
  const [areaM2, setAreaM2] = useState("300");
  const [frequency, setFrequency] = useState("fortnightly"); // fortnightly | 4weeks | oneoff
  const [repeat, setRepeat] = useState("none"); // none | weekly | fortnightly | 4weeks
  const [extras, setExtras] = useState({ weeds: false, hedge: false, waste: false });

  // Costs
  const [km, setKm] = useState("0");
  const [useDump, setUseDump] = useState(false);
  const [dumpFee, setDumpFee] = useState(String(DEFAULT_SETTINGS.dump_fee_default));
  const [useMaterials, setUseMaterials] = useState(false);
  const [materialsCost, setMaterialsCost] = useState(String(DEFAULT_SETTINGS.materials_default));
  const [otherCost, setOtherCost] = useState("0");

  // Photos
  const [beforePhotos, setBeforePhotos] = useState([]);
  const [afterPhotos, setAfterPhotos] = useState([]);

  const isoToday = todayISO();

  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem(STORAGE_KEYS.settings);
        const j = await AsyncStorage.getItem(STORAGE_KEYS.jobs);
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
        if (j) setJobs(JSON.parse(j));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.jobs, JSON.stringify(jobs)).catch(() => {});
  }, [jobs]);

  const pricing = useMemo(() => {
    return calcPricing(Number(areaM2) || 0, frequency, extras, settings);
  }, [areaM2, frequency, extras, settings]);

  const todaysJobs = useMemo(() => {
    const list = jobs.filter((j) => j.date === isoToday && j.status !== "archived");
    return list.sort((a, b) => {
      const ra = suburbRank(a.suburb);
      const rb = suburbRank(b.suburb);
      if (ra !== rb) return ra - rb;
      return String(a.client || "").localeCompare(String(b.client || ""));
    });
  }, [jobs, isoToday]);

  const revenueExGst = useMemo(
    () => todaysJobs.reduce((sum, j) => sum + (Number(j.totalExGst) || 0), 0),
    [todaysJobs]
  );
  const costsToday = useMemo(
    () => todaysJobs.reduce((sum, j) => sum + jobCosts(j, settings), 0),
    [todaysJobs, settings]
  );
  const profitBeforeTax = revenueExGst - costsToday;

  async function ensureMediaPerms() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo access to add before/after photos.");
      return false;
    }
    return true;
  }

  async function pickPhoto(into) {
    const ok = await ensureMediaPerms();
    if (!ok) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    const fname = `photo_${Date.now()}.jpg`;
    const dest = FileSystem.documentDirectory + fname;
    try {
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      if (into === "before") setBeforePhotos((p) => [dest, ...p].slice(0, 6));
      else setAfterPhotos((p) => [dest, ...p].slice(0, 6));
    } catch {
      if (into === "before") setBeforePhotos((p) => [asset.uri, ...p].slice(0, 6));
      else setAfterPhotos((p) => [asset.uri, ...p].slice(0, 6));
    }
  }

  function resetNewJobForm() {
    setClient("");
    setPhone("");
    setEmail("");
    setAddress("");
    setSuburb(settings.start_suburb || "Naenae");
    setAreaM2("300");
    setFrequency("fortnightly");
    setRepeat("none");
    setExtras({ weeds: false, hedge: false, waste: false });
    setKm("0");
    setUseDump(false);
    setDumpFee(String(settings.dump_fee_default ?? 0));
    setUseMaterials(false);
    setMaterialsCost(String(settings.materials_default ?? 0));
    setOtherCost("0");
    setBeforePhotos([]);
    setAfterPhotos([]);
  }

  function saveJob() {
    const job = {
      id: String(Date.now()),
      date: isoToday,
      status: "scheduled",
      client: client.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      suburb: suburb.trim() || "Naenae",
      areaM2: Number(areaM2) || 0,
      frequency,
      repeat,
      extras: { ...extras },
      totalExGst: pricing.exGst,
      gst: pricing.gst,
      totalIncGst: pricing.incGst,
      bandLabel: pricing.bandLabel,

      km: Number(km) || 0,
      useDump,
      dumpFee: Number(dumpFee) || 0,
      useMaterials,
      materialsCost: Number(materialsCost) || 0,
      otherCost: Number(otherCost) || 0,

      beforePhotos,
      afterPhotos,
    };

    setJobs((prev) => [job, ...prev]);
    Alert.alert("Saved", "Added to Today.");
    resetNewJobForm();
    setTab("Today");
  }

  function updateJob(id, patch) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  function completeJob(job) {
    updateJob(job.id, { status: "done" });

    if (!job.repeat || job.repeat === "none") return;
    const next = nextRepeatISO(job.date, job.repeat);
    if (!next) return;

    const nextJob = {
      ...job,
      id: String(Date.now() + 1),
      date: next,
      status: "scheduled",
      beforePhotos: [],
      afterPhotos: [],
    };
    setJobs((prev) => [nextJob, ...prev]);
  }

  function skipJob(job) {
    updateJob(job.id, { status: "skipped" });
  }

  function openRouteInMaps() {
    const stops = todaysJobs
      .map((j) => (j.address ? j.address : j.suburb))
      .filter(Boolean);

    if (stops.length === 0) {
      Alert.alert("No addresses", "Add at least one address (or suburb) for today’s jobs.");
      return;
    }
    const url = buildGoogleMapsMultiStopUrl(stops, settings.start_suburb || "Naenae");
    Linking.openURL(url).catch(() => Alert.alert("Couldn’t open Google Maps"));
  }

  async function emailClient(job, type) {
    if (!job.email) {
      Alert.alert("No email", "Add an email address for this job.");
      return;
    }

    const name = job.client ? job.client : "there";
    let subject = "Straightforward Lawn Care – Today’s Service";
    let body = "";

    if (type === "today") {
      body =
        `Kia ora ${name},\n\n` +
        `We’re scheduled to do your lawn today.\n` +
        `No need to be home — please make sure gates are unlocked and pets are secured.\n\n` +
        `If you need to make any changes, just reply to this email.\n\n` +
        `Cheers,\nStraightforward Lawn Care\n${settings.from_email || "info@straightforwardlawncare.co.nz"}`;
    } else if (type === "late") {
      subject = "Straightforward Lawn Care – Running a bit behind";
      body =
        `Kia ora ${name},\n\n` +
        `Just a quick heads-up we’re running a bit behind today but will still get your lawn done.\n\n` +
        `Cheers,\nStraightforward Lawn Care`;
    } else {
      subject = "Straightforward Lawn Care – Weather delay";
      body =
        `Kia ora ${name},\n\n` +
        `Due to weather we’ll need to shift today’s lawn to the next fine day. We’ll be in touch to confirm.\n\n` +
        `Thanks,\nStraightforward Lawn Care`;
    }

    try {
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        Alert.alert("Email not available", "No email account is set up on this phone.");
        return;
      }
      await MailComposer.composeAsync({
        recipients: [job.email],
        subject,
        body,
      });
    } catch (e) {
      Alert.alert("Couldn’t open email", String(e?.message || e));
    }
  }

  async function exportCSV() {
    const rows = [];
    rows.push(["Exported", new Date().toISOString()]);
    rows.push(["Start suburb", settings.start_suburb || "Naenae"]);
    rows.push([]);
    rows.push(["TODAY", isoToday]);
    rows.push(["Today revenue ex GST", revenueExGst.toFixed(2)]);
    rows.push(["Today costs", costsToday.toFixed(2)]);
    rows.push(["Today profit before tax", profitBeforeTax.toFixed(2)]);
    rows.push([]);
    rows.push([
      "date","client","phone","email","suburb","address","area_m2","frequency","repeat",
      "extras_weeds","extras_hedge","extras_waste",
      "total_ex_gst","gst","total_inc_gst",
      "km","dump_fee","materials_cost","other_cost","status"
    ]);

    for (const j of jobs) {
      rows.push([
        j.date, j.client || "", j.phone || "", j.email || "",
        j.suburb || "", j.address || "", String(j.areaM2 || 0),
        j.frequency || "", j.repeat || "",
        j.extras?.weeds ? "1" : "0",
        j.extras?.hedge ? "1" : "0",
        j.extras?.waste ? "1" : "0",
        String(Number(j.totalExGst || 0).toFixed(2)),
        String(Number(j.gst || 0).toFixed(2)),
        String(Number(j.totalIncGst || 0).toFixed(2)),
        String(Number(j.km || 0)),
        String(j.useDump ? Number(j.dumpFee || 0).toFixed(2) : "0.00"),
        String(j.useMaterials ? Number(j.materialsCost || 0).toFixed(2) : "0.00"),
        String(Number(j.otherCost || 0).toFixed(2)),
        j.status || "",
      ]);
    }

    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? "");
            if (s.includes(",") || s.includes("\n") || s.includes("\"")) return `"${s.replace(/"/g, '""')}"`;
            return s;
          })
          .join(",")
      )
      .join("\n");

    const filename = `straightforward_export_${new Date().toISOString().slice(0,10)}.csv`;
    const path = FileSystem.documentDirectory + filename;

    try {
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert("Exported", `Saved to: ${path}`);
      }
    } catch (e) {
      Alert.alert("Export failed", String(e?.message || e));
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
            <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require("./assets/icon.png")} style={styles.brandLogo} />
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Straightforward Lawn</Text>
            <Text style={styles.h2}>Personal app • Email notify • Today-only schedule</Text>
          </View>
        </View>
      </View>

      <View style={styles.tabs}>
        <TabButton label="Today" active={tab === "Today"} onPress={() => setTab("Today")} />
        <TabButton label="New" active={tab === "New"} onPress={() => setTab("New")} />
        <TabButton label="Settings" active={tab === "Settings"} onPress={() => setTab("Settings")} />
      </View>

      {tab === "Today" && (
        <ScrollView contentContainerStyle={styles.body}>
          <Card
            title={`Today • ${isoToday}`}
            right={
              <Pressable style={styles.smallBtn} onPress={openRouteInMaps}>
                <Text style={styles.smallBtnText}>Route</Text>
              </Pressable>
            }
          >
            <Line label="Revenue (ex GST)" value={money(revenueExGst)} />
            <Line label="Costs" value={money(costsToday)} />
            <BigTotal label="Profit before tax" value={money(profitBeforeTax)} />
            <Pressable style={styles.secondaryBtn} onPress={exportCSV}>
              <Text style={styles.secondaryBtnText}>Export CSV</Text>
            </Pressable>
          </Card>

          <Card title={`Jobs (${todaysJobs.length})`}>
            {todaysJobs.length === 0 ? (
              <Text style={styles.muted}>No jobs saved for today. Tap “New” to add one.</Text>
            ) : (
              todaysJobs.map((j) => (
                <View key={j.id} style={styles.jobCard}>
                  <View style={styles.jobTop}>
                    <Text style={styles.jobTitle}>
                      {j.suburb || "Naenae"} • {money(j.totalExGst)} ex GST
                    </Text>
                    <Text style={[styles.statusPill, j.status === "done" ? styles.pillDone : j.status === "skipped" ? styles.pillSkip : styles.pillSched]}>
                      {j.status || "scheduled"}
                    </Text>
                  </View>
                  <Text style={styles.jobSub}>
                    {j.client ? j.client + " • " : ""}{j.bandLabel || ""} • {j.areaM2 || 0} m²
                  </Text>
                  {j.address ? <Text style={styles.jobAddr}>{j.address}</Text> : null}

                  <View style={styles.jobBtns}>
                    <Pressable style={styles.btnDone} onPress={() => completeJob(j)}>
                      <Text style={styles.btnText}>Done</Text>
                    </Pressable>
                    <Pressable style={styles.btnSkip} onPress={() => skipJob(j)}>
                      <Text style={styles.btnText}>Skip</Text>
                    </Pressable>
                  </View>

                  <View style={styles.jobBtns}>
                    <Pressable style={styles.btnMsg} onPress={() => emailClient(j, "today")}>
                      <Text style={styles.btnText}>Email: Today</Text>
                    </Pressable>
                    <Pressable style={styles.btnMsg} onPress={() => emailClient(j, "late")}>
                      <Text style={styles.btnText}>Email: Late</Text>
                    </Pressable>
                    <Pressable style={styles.btnMsg} onPress={() => emailClient(j, "rain")}>
                      <Text style={styles.btnText}>Email: Rain</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </Card>
        </ScrollView>
      )}

      {tab === "New" && (
        <ScrollView contentContainerStyle={styles.body}>
          <Card title="New Job / Quote">
            <Field label="Client" value={client} onChangeText={setClient} placeholder="Name (optional)" />
            <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="021..." keyboardType="phone-pad" />
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="client@email.com" keyboardType="email-address" />
            <Field label="Suburb" value={suburb} onChangeText={setSuburb} placeholder="Naenae" />
            <Field label="Address" value={address} onChangeText={setAddress} placeholder="Street + suburb (optional)" />
            <NumberField label="Lawn size (m²)" value={areaM2} onChangeNumber={setAreaM2} />

            <View style={styles.segment}>
              {[
                { key: "fortnightly", label: "Fortnightly" },
                { key: "4weeks", label: "4-weekly" },
                { key: "oneoff", label: "One-off" },
              ].map((o) => (
                <Pressable key={o.key} onPress={() => setFrequency(o.key)} style={[styles.segBtn, frequency === o.key && styles.segBtnOn]}>
                  <Text style={[styles.segText, frequency === o.key && styles.segTextOn]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.segment}>
              {[
                { key: "none", label: "No repeat" },
                { key: "weekly", label: "Weekly" },
                { key: "fortnightly", label: "Fortnightly" },
                { key: "4weeks", label: "4 weeks" },
              ].map((o) => (
                <Pressable key={o.key} onPress={() => setRepeat(o.key)} style={[styles.segBtn, repeat === o.key && styles.segBtnOn]}>
                  <Text style={[styles.segText, repeat === o.key && styles.segTextOn]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Extras</Text>
            <Toggle label={`Weed spraying (+${money(settings.extra_weeds)})`} value={extras.weeds} onChange={(v) => setExtras({ ...extras, weeds: v })} />
            <Toggle label={`Hedge trimming (+${money(settings.extra_hedge)})`} value={extras.hedge} onChange={(v) => setExtras({ ...extras, hedge: v })} />
            <Toggle label={`Green waste (+${money(settings.extra_waste)})`} value={extras.waste} onChange={(v) => setExtras({ ...extras, waste: v })} />

            <Text style={styles.sectionTitle}>Costs (optional)</Text>
            <NumberField label="KM (for this job)" value={km} onChangeNumber={setKm} />
            <Toggle label="Dump fee used" value={useDump} onChange={setUseDump} />
            {useDump ? <NumberField label="Dump fee ($)" value={dumpFee} onChangeNumber={setDumpFee} /> : null}
            <Toggle label="Materials used" value={useMaterials} onChange={setUseMaterials} />
            {useMaterials ? <NumberField label="Materials cost ($)" value={materialsCost} onChangeNumber={setMaterialsCost} /> : null}
            <NumberField label="Other cost ($)" value={otherCost} onChangeNumber={setOtherCost} />

            <Text style={styles.sectionTitle}>Photos</Text>
            <View style={styles.photoRow}>
              <Pressable style={styles.photoBtn} onPress={() => pickPhoto("before")}>
                <Text style={styles.photoBtnText}>Add BEFORE</Text>
              </Pressable>
              <Pressable style={styles.photoBtn} onPress={() => pickPhoto("after")}>
                <Text style={styles.photoBtnText}>Add AFTER</Text>
              </Pressable>
            </View>
            {(beforePhotos.length > 0 || afterPhotos.length > 0) ? (
              <View style={styles.photoGrid}>
                {beforePhotos.map((uri) => (<Image key={uri} source={{ uri }} style={styles.photoThumb} />))}
                {afterPhotos.map((uri) => (<Image key={uri} source={{ uri }} style={styles.photoThumb} />))}
              </View>
            ) : null}

            <Card title="Price result">
              <Line label="Band" value={pricing.bandLabel} />
              <Line label="Fortnightly" value={money(pricing.fortnightly)} />
              <Line label="4-weekly" value={money(pricing.monthly)} />
              <Line label="One-off" value={money(pricing.oneoff)} />
              <Line label="Chosen base" value={money(pricing.baseChosen)} />
              <Line label="Extras" value={money(pricing.extrasTotal)} />
              <Line label="Total (ex GST)" value={money(pricing.exGst)} />
              {settings.gst_enabled ? (
                <>
                  <Line label="GST" value={money(pricing.gst)} />
                  <Line label="Total (inc GST)" value={money(pricing.incGst)} />
                </>
              ) : null}
            </Card>

            <Pressable style={styles.primaryBtn} onPress={saveJob}>
              <Text style={styles.primaryBtnText}>Save to Today</Text>
            </Pressable>

            <Pressable style={styles.secondaryBtn} onPress={resetNewJobForm}>
              <Text style={styles.secondaryBtnText}>Clear form</Text>
            </Pressable>
          </Card>
        </ScrollView>
      )}

      {tab === "Settings" && (
        <ScrollView contentContainerStyle={styles.body}>
          <Card title="NZ Settings">
            <Field label="From email" value={settings.from_email} onChangeText={(t)=>setSettings({ ...settings, from_email: t })} placeholder="info@straightforwardlawncare.co.nz" keyboardType="email-address" />
            <Toggle label="GST registered (show GST + inc GST)" value={settings.gst_enabled} onChange={(v) => setSettings({ ...settings, gst_enabled: v })} />
            <NumberField label="GST %" value={String(settings.gst_pct)} onChangeNumber={(v) => setSettings({ ...settings, gst_pct: Number(v) || 0 })} />
            <Field label="Start suburb" value={settings.start_suburb} onChangeText={(t) => setSettings({ ...settings, start_suburb: t })} placeholder="Naenae" />

            <Text style={styles.sectionTitle}>Pricing midpoints (fortnightly)</Text>
            <NumberField label="Small (0–300) $" value={String(settings.small_mid)} onChangeNumber={(v) => setSettings({ ...settings, small_mid: Number(v) || 0 })} />
            <NumberField label="Medium (300–600) $" value={String(settings.med_mid)} onChangeNumber={(v) => setSettings({ ...settings, med_mid: Number(v) || 0 })} />
            <NumberField label="Large (600–900) $" value={String(settings.large_mid)} onChangeNumber={(v) => setSettings({ ...settings, large_mid: Number(v) || 0 })} />
            <NumberField label="XL (900+) $" value={String(settings.xl_mid)} onChangeNumber={(v) => setSettings({ ...settings, xl_mid: Number(v) || 0 })} />

            <Text style={styles.sectionTitle}>Multipliers</Text>
            <NumberField label="4-weekly multiplier" value={String(settings.monthly_mult)} onChangeNumber={(v) => setSettings({ ...settings, monthly_mult: Number(v) || 1 })} />
            <NumberField label="One-off multiplier" value={String(settings.oneoff_mult)} onChangeNumber={(v) => setSettings({ ...settings, oneoff_mult: Number(v) || 1 })} />

            <Text style={styles.sectionTitle}>Extras</Text>
            <NumberField label="Weeds $" value={String(settings.extra_weeds)} onChangeNumber={(v) => setSettings({ ...settings, extra_weeds: Number(v) || 0 })} />
            <NumberField label="Hedge $" value={String(settings.extra_hedge)} onChangeNumber={(v) => setSettings({ ...settings, extra_hedge: Number(v) || 0 })} />
            <NumberField label="Green waste $" value={String(settings.extra_waste)} onChangeNumber={(v) => setSettings({ ...settings, extra_waste: Number(v) || 0 })} />

            <Text style={styles.sectionTitle}>Costs</Text>
            <NumberField label="Fuel cost per KM $" value={String(settings.fuel_cost_per_km)} onChangeNumber={(v) => setSettings({ ...settings, fuel_cost_per_km: Number(v) || 0 })} />
            <NumberField label="Default dump fee $" value={String(settings.dump_fee_default)} onChangeNumber={(v) => setSettings({ ...settings, dump_fee_default: Number(v) || 0 })} />
            <NumberField label="Default materials $" value={String(settings.materials_default)} onChangeNumber={(v) => setSettings({ ...settings, materials_default: Number(v) || 0 })} />
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1220" },
  header: { padding: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandLogo: { width: 54, height: 54, borderRadius: 12 },
  h1: { color: "white", fontSize: 18, fontWeight: "800" },
  h2: { color: "#9ca3af", marginTop: 4 },

  tabs: { flexDirection: "row", paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: "#111827", alignItems: "center" },
  tabBtnActive: { backgroundColor: "#0f766e" },
  tabText: { color: "#cbd5e1", fontWeight: "700" },
  tabTextActive: { color: "white" },

  body: { padding: 12, paddingBottom: 30, gap: 12 },

  card: { backgroundColor: "#111827", borderRadius: 16, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: "white", fontWeight: "800" },
  cardBody: { gap: 10, marginTop: 10 },

  line: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { color: "#cbd5e1" },
  lineValue: { color: "white", fontWeight: "800" },

  bigTotal: { marginTop: 6, padding: 12, borderRadius: 14, backgroundColor: "#052e2b" },
  bigLabel: { color: "#a7f3d0", fontWeight: "900" },
  bigValue: { color: "white", fontSize: 22, fontWeight: "900", marginTop: 4 },

  toggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 6, backgroundColor: "#0b1220", borderWidth: 1, borderColor: "#334155" },
  checkboxOn: { backgroundColor: "#22c55e", borderColor: "#22c55e" },
  toggleText: { color: "#e5e7eb", fontWeight: "700" },

  label: { color: "#cbd5e1", fontWeight: "700", width: 140 },
  fieldRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  input: { flex: 1, backgroundColor: "#0b1220", borderRadius: 12, padding: 12, color: "white" },

  segment: { flexDirection: "row", backgroundColor: "#0b1220", borderRadius: 12, padding: 4, gap: 4, marginTop: 4 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  segBtnOn: { backgroundColor: "#0f766e" },
  segText: { color: "#cbd5e1", fontWeight: "800" },
  segTextOn: { color: "white" },

  sectionTitle: { color: "white", fontWeight: "900", marginTop: 10 },

  primaryBtn: { backgroundColor: "#0f766e", padding: 14, borderRadius: 14, alignItems: "center", marginTop: 6 },
  primaryBtnText: { color: "white", fontWeight: "900" },

  secondaryBtn: { backgroundColor: "#1f2937", padding: 14, borderRadius: 14, alignItems: "center", marginTop: 6 },
  secondaryBtnText: { color: "white", fontWeight: "800" },

  jobCard: { backgroundColor: "#0b1220", borderRadius: 14, padding: 12, marginBottom: 10, gap: 6 },
  jobTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  jobTitle: { color: "white", fontWeight: "900" },
  jobSub: { color: "#cbd5e1" },
  jobAddr: { color: "#9ca3af" },

  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden", fontWeight: "900", color: "white" },
  pillDone: { backgroundColor: "#166534" },
  pillSkip: { backgroundColor: "#7c2d12" },
  pillSched: { backgroundColor: "#0f766e" },

  jobBtns: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
  btnDone: { backgroundColor: "#166534", padding: 10, borderRadius: 12 },
  btnSkip: { backgroundColor: "#7c2d12", padding: 10, borderRadius: 12 },
  btnMsg: { backgroundColor: "#0f766e", padding: 10, borderRadius: 12 },
  btnText: { color: "white", fontWeight: "900" },

  muted: { color: "#9ca3af" },

  smallBtn: { backgroundColor: "#0f766e", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  smallBtnText: { color: "white", fontWeight: "900" },

  photoRow: { flexDirection: "row", gap: 10 },
  photoBtn: { flex: 1, backgroundColor: "#1f2937", padding: 12, borderRadius: 12, alignItems: "center" },
  photoBtnText: { color: "white", fontWeight: "900" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: 12 },
});
