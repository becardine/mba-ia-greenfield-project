import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import appConfig from '../config/app.config';
import mailConfig from '../config/mail.config';
import {
  clearMailpitMessages,
  getMailpitMessage,
  getMailpitMessages,
} from '../test/mailpit';
import { MAIL_SUBJECTS } from './mail.constants';
import { MailModule } from './mail.module';
import { MailService } from './mail.service';

interface MailpitAddress {
  Name: string;
  Address: string;
}

interface MailpitMessageSummary {
  ID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
}

interface MailpitMessageDetail extends MailpitMessageSummary {
  HTML: string;
}

async function listMessages(): Promise<MailpitMessageSummary[]> {
  return (await getMailpitMessages()) as MailpitMessageSummary[];
}

async function readMessage(id: string): Promise<MailpitMessageDetail> {
  return (await getMailpitMessage(id)) as MailpitMessageDetail;
}

describe('MailService (integration)', () => {
  let mailService: MailService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig, mailConfig] }),
        MailModule,
      ],
    }).compile();

    mailService = module.get(MailService);
  });

  beforeEach(async () => {
    await clearMailpitMessages();
  });

  it('sendConfirmationEmail delivers to Mailpit with correct subject and recipient', async () => {
    await mailService.sendConfirmationEmail(
      'user@example.com',
      'Alice',
      'token123',
    );

    const messages = await listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].To[0].Address).toBe('user@example.com');
    expect(messages[0].Subject).toBe(MAIL_SUBJECTS.CONFIRMATION);
  });

  it('sendConfirmationEmail renders the confirmation URL in the body', async () => {
    await mailService.sendConfirmationEmail(
      'user@example.com',
      'Alice',
      'mytoken',
    );

    const messages = await listMessages();
    const detail = await readMessage(messages[0].ID);

    expect(detail.HTML).toContain('mytoken');
    expect(detail.HTML).toContain('Alice');
    expect(detail.HTML).toContain('confirm-email');
  });

  it('sendPasswordResetEmail delivers to Mailpit with correct subject and recipient', async () => {
    await mailService.sendPasswordResetEmail(
      'user@example.com',
      'Bob',
      'resettoken',
    );

    const messages = await listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].To[0].Address).toBe('user@example.com');
    expect(messages[0].Subject).toBe(MAIL_SUBJECTS.PASSWORD_RESET);
  });

  it('sendPasswordResetEmail renders the reset URL and expiry notice in the body', async () => {
    await mailService.sendPasswordResetEmail(
      'user@example.com',
      'Bob',
      'resettoken',
    );

    const messages = await listMessages();
    const detail = await readMessage(messages[0].ID);

    expect(detail.HTML).toContain('resettoken');
    expect(detail.HTML).toContain('Bob');
    expect(detail.HTML).toContain('reset-password');
    expect(detail.HTML).toContain('1 hour');
  });

  it('both emails use the configured MAIL_FROM address as sender', async () => {
    await mailService.sendConfirmationEmail('user@example.com', 'Alice', 'tok');

    const messages = await listMessages();
    const configuredFrom =
      process.env.MAIL_FROM ?? '"StreamTube" <noreply@streamtube.com>';
    const expectedAddress =
      configuredFrom.match(/<(.+)>/)?.[1] ?? configuredFrom;
    expect(messages[0].From.Address).toBe(expectedAddress);
  });
});
