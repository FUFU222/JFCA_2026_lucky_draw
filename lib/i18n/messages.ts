export type Locale = 'en' | 'ja';

export const LOCALES: readonly Locale[] = ['en', 'ja'];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ja';
}

/**
 * Every visitor-facing string lives here so the two languages stay in step and
 * a copy change never means hunting through components.
 */
export const messages = {
  en: {
    localeSwitcher: { label: 'Language', en: 'English', ja: '日本語' },

    form: {
      profileHeading: 'Tell us a little about yourself',
      profileNote: 'Optional. It helps us tell you about things you might like.',
      firstName: 'First name',
      lastName: 'Last name',
      phone: 'Phone number',
      gender: 'Gender',
      genderUnset: 'Prefer not to say',
      genderFemale: 'Female',
      genderMale: 'Male',
      genderOther: 'Another gender',
      dateOfBirth: 'Date of birth',
      country: 'Country',
      region: 'Province / State / Region',

      numberHeading: 'Get your Lucky Draw number',
      numberNote: 'We email you a link to confirm your address. Your number comes right after.',
      email: 'Email address',
      emailRequired: 'Required',
      consent: 'I agree to the Privacy Policy and the Terms',
      consentPrivacy: 'Privacy Policy',
      consentTerms: 'Terms',
      submit: 'Send confirmation email',
      submitting: 'Sending…',

      captchaPending: 'Checking your browser…',
      captchaFailed: 'That check did not pass. Reload the page and try again.',

      errorEmail: 'Enter an email address you can open right now.',
      errorConsent: 'Please agree to the Privacy Policy and the Terms.',
      errorGeneric: 'Something went wrong. Please try again.',
      errorRateLimited:
        'Too many attempts from this network. Ask a member of staff for help, or try again from mobile data.',
      errorClosed: 'Entries are not open at the moment.',
    },

    sendDialog: {
      title: 'Send the confirmation email?',
      body: 'We will send your confirmation link to:',
      hint: 'Open it within 24 hours to get your number.',
      confirm: 'Send confirmation email',
      cancel: 'Go back',
    },

    submitted: {
      heading: 'Check your email',
      body: 'If this address can enter, a confirmation link is on its way to it.',
      spam: 'No message after a few minutes? Check your spam folder.',
      resend: 'Send it again',
      resendDialogTitle: 'Send the confirmation email again?',
      resendDialogBody: 'We will send the same link to:',
      resendDialogHint: 'You can request it up to three times in 24 hours.',
      resendDialogConfirm: 'Send again',
      resendDialogCancel: 'Go back',
      resendDone: 'If this address can enter, another link is on its way.',
    },

    verify: {
      heading: 'Confirm your email',
      body: 'Confirming issues your Lucky Draw number. It cannot be changed afterwards.',
      action: 'Confirm and get my number',
      dialogTitle: 'Get your Lucky Draw number?',
      dialogBody: 'Your number is issued now and stays yours for this event.',
      dialogConfirm: 'Get my number',
      dialogCancel: 'Go back',
      working: 'Issuing your number…',
      invalidHeading: 'This link cannot be used',
      invalidBody:
        'It may have expired, or it may already have been used. Enter again to get a new link.',
      invalidAction: 'Go to the entry form',
      failed: 'Your number could not be issued. Please try again.',
    },

    receipt: {
      label: 'Your Lucky Draw Number',
      heading: 'Your entry is confirmed',
      screenshot: 'Save this number. A screenshot is the easiest way.',
      venue: 'Results are announced at the venue. Compare them with the number above.',
      emailed: 'We also emailed this number to you.',
      support: 'Lost your number? Contact',
      notFoundHeading: 'This number page cannot be found',
      notFoundBody: 'Check the link in your email, or contact',
    },

    schedule: {
      beforeHeading: 'Entries are not open yet',
      beforeBody: 'Come back when entries open at this event.',
      closedHeading: 'Entries are closed',
      closedBody: 'Thank you for your interest. Results are announced at the venue.',
    },

    terms: { heading: 'Lucky Draw Terms', back: 'Back to the entry form' },
    notFound: { heading: 'Event not found', body: 'Check the address on the QR code.' },
  },

  ja: {
    localeSwitcher: { label: '言語', en: 'English', ja: '日本語' },

    form: {
      profileHeading: 'あなたについて教えてください',
      profileNote: '任意です。よりよいご案内のためにお聞かせください。',
      firstName: '名',
      lastName: '姓',
      phone: '電話番号',
      gender: '性別',
      genderUnset: '回答しない',
      genderFemale: '女性',
      genderMale: '男性',
      genderOther: 'その他',
      dateOfBirth: '生年月日',
      country: '国',
      region: '州・地域',

      numberHeading: '抽選番号を受け取る',
      numberNote:
        'メールアドレス確認のリンクをお送りします。ご確認いただくとすぐに番号を発行します。',
      email: 'メールアドレス',
      emailRequired: '必須',
      consent: 'プライバシーポリシーおよび利用規約に同意する',
      consentPrivacy: 'プライバシーポリシー',
      consentTerms: '利用規約',
      submit: '確認メールを送信',
      submitting: '送信中…',

      captchaPending: 'ブラウザを確認しています…',
      captchaFailed: '確認できませんでした。ページを再読み込みしてお試しください。',

      errorEmail: 'いますぐ開けるメールアドレスをご入力ください。',
      errorConsent: 'プライバシーポリシーおよび利用規約への同意が必要です。',
      errorGeneric: '処理できませんでした。もう一度お試しください。',
      errorRateLimited:
        'このネットワークからの試行が上限に達しました。スタッフにお声がけいただくか、モバイル回線からお試しください。',
      errorClosed: '現在、受付を行っていません。',
    },

    sendDialog: {
      title: '確認メールを送信しますか',
      body: '次のアドレスに確認リンクをお送りします。',
      hint: '24時間以内に開くと番号を受け取れます。',
      confirm: '確認メールを送信',
      cancel: '戻る',
    },

    submitted: {
      heading: 'メールをご確認ください',
      body: 'ご応募いただける場合、確認リンクをそのアドレスにお送りしています。',
      spam: '数分たっても届かない場合は、迷惑メールフォルダをご確認ください。',
      resend: 'もう一度送る',
      resendDialogTitle: '確認メールを再送しますか',
      resendDialogBody: '次のアドレスに同じリンクをお送りします。',
      resendDialogHint: '24時間に3回までご依頼いただけます。',
      resendDialogConfirm: '再送する',
      resendDialogCancel: '戻る',
      resendDone: 'ご応募いただける場合、あらためてリンクをお送りしています。',
    },

    verify: {
      heading: 'メールアドレスの確認',
      body: '確認すると抽選番号を発行します。発行後の変更はできません。',
      action: '確認して番号を受け取る',
      dialogTitle: '抽選番号を受け取りますか',
      dialogBody: 'いま番号を発行します。このイベントの間、番号は変わりません。',
      dialogConfirm: '番号を受け取る',
      dialogCancel: '戻る',
      working: '番号を発行しています…',
      invalidHeading: 'このリンクはご利用いただけません',
      invalidBody:
        '有効期限が切れたか、すでに使用された可能性があります。応募フォームからあらためてお手続きください。',
      invalidAction: '応募フォームへ',
      failed: '番号を発行できませんでした。もう一度お試しください。',
    },

    receipt: {
      label: 'Your Lucky Draw Number',
      heading: 'ご応募を受け付けました',
      screenshot: 'この番号をお控えください。スクリーンショットでの保存がおすすめです。',
      venue: '抽選結果は会場で発表されます。上記の番号とお照らし合わせください。',
      emailed: 'この番号はメールでもお送りしています。',
      support: '番号がわからなくなった場合は',
      notFoundHeading: 'この番号確認ページは見つかりません',
      notFoundBody: 'メールのリンクをご確認いただくか、次の宛先までご連絡ください:',
    },

    schedule: {
      beforeHeading: '受付開始前です',
      beforeBody: '受付開始後にあらためてアクセスしてください。',
      closedHeading: '受付を終了しました',
      closedBody: 'ご関心をお寄せいただきありがとうございます。抽選結果は会場で発表されます。',
    },

    terms: { heading: 'Lucky Draw 利用規約', back: '応募フォームへ戻る' },
    notFound: { heading: 'イベントが見つかりません', body: 'QRコードのアドレスをご確認ください。' },
  },
} as const;

export type Messages = (typeof messages)['en'];

export function messagesFor(locale: Locale): Messages {
  return messages[locale] as Messages;
}
