import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  "Urban Deco Trade <trade@urbandeco.co.uk>";

/* ============================================================
   SEND TRADE APPROVAL EMAIL
============================================================ */

export async function sendTradeApprovalEmail(
  application
) {
  if (!application?.email) {
    console.log(
      "APPROVAL EMAIL SKIPPED: NO APPLICANT EMAIL."
    );

    return;
  }

  try {
    const { data, error } =
      await resend.emails.send({
        from: EMAIL_FROM,
        to: application.email,
        subject:
          "Your Urban Deco Trade Account Has Been Approved",
        html: `
          <!DOCTYPE html>
          <html>
            <body
              style="
                margin:0;
                padding:0;
                background:#f5f5f5;
                font-family:Arial, Helvetica, sans-serif;
                color:#222222;
              "
            >

              <div
                style="
                  max-width:600px;
                  margin:0 auto;
                  background:#ffffff;
                "
              >

                <div
                  style="
                    padding:35px 30px;
                    text-align:center;
                    border-bottom:1px solid #eeeeee;
                  "
                >
                  <img
    src="https://cdn.shopify.com/s/files/1/0673/0734/0017/files/URBANDECO-1200X1200.jpg?v=1787744700"
    alt="Urban Deco"
    width="180"
    style="
      display:block;
      width:180px;
      max-width:100%;
      height:auto;
      margin:0 auto;
      border:0;
    "
  />
                  <p
                    style="
                      margin:8px 0 0;
                      color:#777777;
                      font-size:14px;
                    "
                  >
                    Trade Account
                  </p>
                </div>

                <div
                  style="
                    padding:35px 30px;
                  "
                >

                  <h2
                    style="
                      margin-top:0;
                      font-size:24px;
                    "
                  >
                    Your Trade Account Has Been Approved
                  </h2>

                  <p>
                    Hi ${application.firstName},
                  </p>

                  <p>
                    Great news! Your application for an
                    Urban Deco Trade Account has been approved.
                  </p>
                  <p>
                     As an approved Urban Deco trade customer, you now have access to three flexible pricing options, designed to give you greater value and flexibility on your projects:
                      </p>
                      <p>
                      <strong> 1. Trade Discount </strong> </br>Enjoy a flat percentage discount on your purchases, giving you straightforward trade pricing every time you order.
                      </p>
                      <p>
                      <strong>2. Referral </strong> </br>Refer your clients to Urban Deco and earn commission on their purchases. It’s a simple way to turn your client recommendations into an additional reward.
                      </p>
                      <p>
                      <strong>3. Flexible Project Reward </strong></br>Share a total discount benefit your way. Choose how much of the available benefit you’d like to pass on to your client and how much you’d like to retain as your professional reward.
                      </p>
                      <p>
                      <strong>Need a little more information before choosing your preferred option? </strong></br>Our team will be happy to explain how each pricing option works and help you find the right fit for your business.
                      </p>
                      <p>
                      <strong>Ready to choose your preferred option? </strong></br>Get in touch with our team and we’ll be happy to discuss the options available to you and help you choose the right one for your business.
                      </p>
                      <p>
                     📧 <a href="mailto:customerservice@urbandeco.co.uk">
    customerservice@urbandeco.co.uk
  </a>
                      </p>
                      <p>
                     📞 <a href="tel:+441162962565">
    0116-296-2565
  </a>
                      </p>
            

                  <p>
                    You can now access your trade account and
                    enjoy the benefits available to approved
                    Urban Deco trade customers.
                  </p>

                  <div
                    style="
                      text-align:center;
                      margin:35px 0;
                    "
                  >
                    <a
                      href="https://www.urbandeco.co.uk"
                      style="
                        display:inline-block;
                        padding:14px 26px;
                        background:#1a1a1a;
                        color:#ffffff;
                        text-decoration:none;
                        font-weight:600;
                      "
                    >
                      Visit Urban Deco
                    </a>
                  </div>
                  <p>
                    If you have any questions, please contact
                    our team and we will be happy to help.
                  </p>

              

                  <p
                    style="
                      margin-bottom:0;
                    "
                  >
                    Kind regards,<br />
                    <strong>Urban Deco Trade Team</strong>
                  </p>

                </div>

                <div
                  style="
                    padding:20px 30px;
                    background:#f5f5f5;
                    color:#777777;
                    font-size:12px;
                    text-align:center;
                  "
                >
                  © ${new Date().getFullYear()} Urban Deco.
                  All rights reserved.
                </div>

              </div>

            </body>
          </html>
        `,
      });

    if (error) {
      console.error(
        "RESEND APPROVAL EMAIL ERROR:",
        error
      );

      return {
        success: false,
        error,
      };
    }

    console.log(
      "TRADE APPROVAL EMAIL SENT:",
      application.email
    );

    console.log(
      "RESEND EMAIL ID:",
      data?.id
    );

    return {
      success: true,
      emailId: data?.id,
    };

  } catch (error) {

    console.error(
      "APPROVAL EMAIL SEND ERROR:",
      error
    );

    return {
      success: false,
      error,
    };
  }
}


/* ============================================================
   SEND TRADE REJECTION EMAIL
============================================================ */

export async function sendTradeRejectionEmail(
  application,
  rejectionReason
) {
  if (!application?.email) {
    console.log(
      "REJECTION EMAIL SKIPPED: NO APPLICANT EMAIL."
    );

    return;
  }

  try {

    const reasonHtml =
      rejectionReason
        ? `
          <div
            style="
              margin:25px 0;
              padding:18px;
              background:#f7f7f7;
              border-left:4px solid #333333;
            "
          >
            <strong>Reason:</strong><br /><br />
            ${rejectionReason}
          </div>
        `
        : "";

    const { data, error } =
      await resend.emails.send({
        from: EMAIL_FROM,
        to: application.email,
        subject:
          "Update on Your Urban Deco Trade Account Application",
        html: `
          <!DOCTYPE html>
          <html>
            <body
              style="
                margin:0;
                padding:0;
                background:#f5f5f5;
                font-family:Arial, Helvetica, sans-serif;
                color:#222222;
              "
            >

              <div
                style="
                  max-width:600px;
                  margin:0 auto;
                  background:#ffffff;
                "
              >

                <div
                  style="
                    padding:35px 30px;
                    text-align:center;
                    border-bottom:1px solid #eeeeee;
                  "
                >
                  <h1
                    style="
                      margin:0;
                      font-size:28px;
                      font-weight:600;
                    "
                  >
                    Urban Deco
                  </h1>

                  <p
                    style="
                      margin:8px 0 0;
                      color:#777777;
                      font-size:14px;
                    "
                  >
                    Trade Account
                  </p>
                </div>

                <div
                  style="
                    padding:35px 30px;
                  "
                >

                  <h2
                    style="
                      margin-top:0;
                      font-size:24px;
                    "
                  >
                    Update on Your Application
                  </h2>

                  <p>
                    Hi ${application.firstName},
                  </p>

                  <p>
                    Thank you for your interest in opening an
                    Urban Deco Trade Account.
                  </p>

                  <p>
                    After reviewing your application,
                    we are unfortunately unable to approve
                    your application at this time.
                  </p>

                  ${reasonHtml}

                  <p>
                    Thank you for your interest in
                    Urban Deco.
                  </p>

                  <p
                    style="
                      margin-bottom:0;
                    "
                  >
                    Kind regards,<br />
                    <strong>Urban Deco Trade Team</strong>
                  </p>

                </div>

                <div
                  style="
                    padding:20px 30px;
                    background:#f5f5f5;
                    color:#777777;
                    font-size:12px;
                    text-align:center;
                  "
                >
                  © ${new Date().getFullYear()} Urban Deco.
                  All rights reserved.
                </div>

              </div>

            </body>
          </html>
        `,
      });

    if (error) {
      console.error(
        "RESEND REJECTION EMAIL ERROR:",
        error
      );

      return {
        success: false,
        error,
      };
    }

    console.log(
      "TRADE REJECTION EMAIL SENT:",
      application.email
    );

    console.log(
      "RESEND EMAIL ID:",
      data?.id
    );

    return {
      success: true,
      emailId: data?.id,
    };

  } catch (error) {

    console.error(
      "REJECTION EMAIL SEND ERROR:",
      error
    );

    return {
      success: false,
      error,
    };
  }
}