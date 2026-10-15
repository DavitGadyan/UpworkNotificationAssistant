import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Banner, Button, Card, Field, T } from "../components/ui";
import { haptic } from "../lib/haptics";
import { supabase } from "../lib/supabase";
import { font, useTheme } from "../theme";

/* Email one-time code: works in Expo Go without deep links. */
export default function SignIn() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function sendCode() {
    setBusy(true); setError(null); setInfo(null);
    const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() });
    setBusy(false);
    if (e) { haptic.error(); setError(e.message); return; }
    haptic.light();
    setStep("code");
    setInfo(`We emailed a 6-digit code to ${email.trim()}.`);
  }

  async function verify() {
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (e) { haptic.error(); setError(e.message); return; }
    haptic.success();
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.ground }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, paddingTop: insets.top + 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginBottom: 28, gap: 14 }}>
          <Image source={require("../../assets/logo.png")} style={{ width: 72, height: 72 }} accessibilityLabel="Up Assistant logo" />
          <T weight="display" size={28} style={{ textTransform: "uppercase", letterSpacing: -0.2, fontFamily: font.display }}>Up Assistant</T>
          <T muted size={15} style={{ textAlign: "center", maxWidth: 300 }}>Ranked job alerts, proposal drafts and closing advice - in your pocket.</T>
        </View>

        <Card style={{ gap: 4 }}>
          {step === "email" ? (
            <>
              <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="send" onSubmitEditing={() => validEmail && sendCode()} />
              <Button label="Send sign-in code" variant="dark" onPress={sendCode} loading={busy} disabled={!validEmail} />
            </>
          ) : (
            <>
              {info ? <Banner tone="info">{info}</Banner> : null}
              <Field label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} placeholder="123456" keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} autoFocus onSubmitEditing={() => code.length === 6 && verify()} />
              <Button label="Verify and sign in" variant="dark" onPress={verify} loading={busy} disabled={code.length !== 6} />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Button label="Change email" variant="ghost" small onPress={() => { setStep("email"); setCode(""); setInfo(null); }} style={{ flex: 1 }} />
                <Button label="Resend code" variant="ghost" small onPress={sendCode} disabled={busy} style={{ flex: 1 }} />
              </View>
            </>
          )}
          {error ? <Banner tone="bad" title="Sign-in failed">{error}</Banner> : null}
        </Card>
        <T faint size={12} style={{ textAlign: "center", marginTop: 16 }}>{"Only the owner's email can sign in."}</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
