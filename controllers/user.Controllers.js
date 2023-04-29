const Joi = require("joi");
const otpGenerator = require("otp-generator");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/mysql/mysql");
require("dotenv").config();
const twilio = require("twilio")(process.env.SID, process.env.AUTH_TOKEN);
const mysql = require("mysql");
const jwt = require("jsonwebtoken");

const object = Joi.object({
  name: Joi.string().min(5).max(100),
  email: Joi.string().min(3).email().max(200).required(),
  password: Joi.string().min(8).max(100).required(),
  number: Joi.string().required(),
});

const conn = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "re_pro",
});

// Generate token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.user_id,
      number: user.number,
      verified: user.verified,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );
};

// User register
const userRegister = async (req, res) => {
  try {
    const { email, number, password } = req.body;
    if (!email || !password || !number) {
      return res.status(400).send({ message: "All credentials are required!" });
    } else {
      const { error } = object.validate(req.body);
      if (error) {
        return res.status(400).send({ message: error.details[0].message });
      } else {
        let sql = `SELECT * FROM users WHERE email = '${email}' OR number = '${number}'`;
        conn.query(sql, async (error, data) => {
          if (error) {
            return res
              .status(500)
              .send({ message: "Internal server error..." });
          } else {
            if (data.length !== 0) {
              return res.status(400).send({ message: "User already exists!" });
            } else {
              // Generate otp
              const OTP = otpGenerator.generate(6, {
                digits: true,
                lowerCaseAlphabets: false,
                upperCaseAlphabets: false,
                specialChars: false,
              });

              // Hash otp
              const hashedOtp = await bcrypt.hash(OTP, 10);

              // check the otp existence
              const sql = `SELECT * FROM otps WHERE number = '${number}'`;
              conn.query(sql, async (error, data) => {
                if (error) {
                  console.log(error);
                  return res
                    .status(500)
                    .send({ message: "Internal server error..." });
                } else {
                  // Save otp to database
                  const sql2 = `INSERT INTO otps (number, otp) VALUES ('${number}', '${hashedOtp}')`;
                  conn.query(sql2, async (error, data) => {
                    if (error) {
                      console.log(error);
                      return res
                        .status(500)
                        .send({ message: "Internal server error..." });
                    } else {
                      try {
                        // Send otp
                        const message = await twilio.messages.create({
                          from: "+12765985304",
                          to: number,
                          body: `Your Verification Code is ${OTP}`,
                        });

                        if (!message) {
                          console.log(error);
                          return res
                            .status(500)
                            .send({ message: "Internal server error..." });
                        } else {
                          const hashedPass = await bcrypt.hash(password, 10);
                          // Save user
                          const sql = `INSERT INTO users (email, password, number) VALUES ('${email}', '${hashedPass}', '${number}')`;
                          conn.query(sql, async (error, data) => {
                            if (error) {
                              return res
                                .status(500)
                                .send({ message: "Internal server error..." });
                            } else {
                              // Get user
                              const sql = `SELECT * FROM users WHERE email = '${email}' AND number = '${number}'`;
                              conn.query(sql, (error, data) => {
                                if (error) {
                                  console.log(error);
                                  return res.status(500).send({
                                    message: "Internal server error...",
                                  });
                                } else {
                                  console.log(OTP);
                                  return res.status(201).send({
                                    data,
                                    token: generateToken(data[0]),
                                    message: `Code sent to ${number} verify to proceed...`,
                                  });
                                }
                              });
                            }
                          });
                        }
                      } catch (error) {
                        console.log(error);
                        return res
                          .status(500)
                          .send({ message: "Internal server error..." });
                      }
                    }
                  });
                }
              });
            }
          }
        });
      }
    }
  } catch (error) {
    console.log(error);
    return res.status(500).send({ message: "Internal server error..." });
  }
};

// Verify otp
const verifyOtp = async (req, res) => {
  try {
    const number = req.body.number;
    const otp = req.body.otp;

    // Check otp existence
    const sql = `SELECT * FROM otps WHERE number = '${number}'`;
    conn.query(sql, async (error, data) => {
      if (error) {
        return res.status(400).send({ message: "Internal server error..." });
      } else {
        // console.log(data)
        if (data.length == 0) {
          return res.status(400).send({ message: "Invalid Code!" });
        } else {
          // Compare otp
          const validOtp = await bcrypt.compare(otp, data[0].otp);
          if (!validOtp) {
            return res.status(400).send({ message: "Invalid code!" });
          } else {
            // Delete code
            const sql = `DELETE FROM otps WHERE number = '${number}'`;
            conn.query(sql, async (error, data) => {
              if (error) {
                return res
                  .status(500)
                  .send({ message: "Internal server error..." });
              } else {
                // Update user verification
                const sql = `UPDATE users SET verified = 'True' WHERE number = '${number}'`;
                conn.query(sql, async (error, data) => {
                  if (error) {
                    return res
                      .status(500)
                      .send({ message: "Internal server error..." });
                  } else {
                    // Get user
                    const sql = `SELECT * FROM users WHERE number = '${number}'`;
                    conn.query(sql, async (error, data) => {
                      if (error) {
                        return res
                          .status(500)
                          .send({ message: "Internal server error..." });
                      } else {
                        return res.status(201).send({
                          data,
                          token: generateToken(data[0]),
                          message: "User verified...",
                        });
                      }
                    });
                  }
                });
              }
            });
          }
        }
      }
    });
  } catch (error) {
    console.log(error);
  }
};

// Update user stats
const updateUserStats = async (req, res) => {
  try {
    const { position, church, language, idNumber } = req.body;
    if (!position || !church || !language || !idNumber) {
      return res.status(400).send({ message: "All inputs are required!" });
    } else {
      // Get user to update
      const sql2 = `SELECT * FROM users WHERE number = '${user.number}'`;
      const number = user.number;
      conn.query(sql2, async (error, data) => {
        if (error) {
            console.log(error);
          return res.status(500).send({ message: "Internal server error..." });
        } else {
          // Update user
          const sql = `UPDATE users SET position = '${position}', church = '${church}', language = '${language}', idNumber = '${idNumber}'`;
          conn.query(sql, async (error, data) => {
            if (error) {
                console.log(error);
              return res
                .status(500)
                .send({ message: "Internal server error..." });
            } else {
              // Get the user to return
              const sql = `SELECT * FROM users WHERE number = '${number}'`;
              conn.query(sql, async (error, data) => {
                if (error) {
                    console.log(error);
                  return res
                    .status(500)
                    .send({ message: "Internal server error..." });
                } else {
                  return res.status(201).send({
                    data,
                    token: generateToken(data),
                    message: 'User stats updated...'
                  })
                }
              });
            }
          });
        }
      });
    }
  } catch (error) {
      console.log(error);
    return res.status(500).send({ message: "Internal server error..." });
  }
};

module.exports = {
  userRegister,
  verifyOtp,
  updateUserStats,
};
