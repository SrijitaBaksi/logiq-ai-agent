const vscode = require('vscode');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const { GoogleGenAI } = require('@google/genai');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fetch = require('node-fetch');

const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });



async function generatePlan(task) {
  console.log("🔑 Loaded API Key:", process.env.GEMINI_API_KEY);
	const apiKey=process.env.GEMINI_API_KEY



  
	const ai= new  GoogleGenAI({ apiKey: `${apiKey}`});

 
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `Give me a step-by-step(one line at a time ) terminal commands only(do not include extra suggestions just commands ) plan so that it runs effectively keeping in mind the platform whose terminal it is, to do this : ${task}`

  });
  

  
	
	const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  
	if (!text) throw new Error("❌ No response from Gemini API");
  
  const plan = text
  .split('\n')
  .map(line => line.trim())
  .filter(line =>
    line &&
    !line.startsWith('```') &&         
    !line.toLowerCase().startsWith('#') && 
    !line.includes('Output:') &&       
    !line.startsWith('$')            
  )
  .map(line => line.replace(/^\$\s*/, ''));

	return plan;
  }

async function executeCommands(commands, outputChannel) {
    for (const command of commands) {
      outputChannel.appendLine(`\n$ ${command}`);
      try {
        const { stdout, stderr } = await execAsync(command);
        if (stdout) outputChannel.appendLine(`Output: ${stdout}`);
        if (stderr) outputChannel.appendLine(`Error: ${stderr}`);
      } catch (err) {
        outputChannel.appendLine(`Execution failed: ${err}`);
        return false;
      }
    }
    return true;
  }

function activate(context) {
  console.log("AI agent activated");

  let disposable = vscode.commands.registerCommand('logiq-ai-agent.helloWorld', async function () {
    const outputChannel = vscode.window.createOutputChannel('AI Agent');
    outputChannel.show();

    try {
      console.log("Prompt is being displayed");
      const task = await vscode.window.showInputBox({
        prompt: 'Enter the task (e.g., "Generate and run a simple Node.js server")',
        ignoreFocusOut: true
      });

      if (!task) {
        vscode.window.showErrorMessage('No task provided.');
        return;
      }

      console.log(`Task received: ${task}`);
      outputChannel.appendLine(`📝 Task: ${task}`);

      const plan = await generatePlan(task);
      outputChannel.appendLine('\n📋 Generated Plan:');
      plan.forEach((step, index) => outputChannel.appendLine(`${index + 1}. ${step}`));

      const approval = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Do you approve the plan?'
      });

      if (approval !== 'Yes') {
        vscode.window.showInformationMessage('Plan not approved. Exiting.');
        return;
      }

      let success = await executeCommands(plan, outputChannel);

      while (!success) {
        const reason = await vscode.window.showInputBox({
          prompt: 'Task failed. What went wrong?',
          ignoreFocusOut: true
        });

        if (!reason) {
          vscode.window.showInformationMessage('No feedback provided. Exiting.');
          return;
        }

        const refinedTask = `${task}. Note: Last attempt failed because: ${reason}`;
        const newPlan = await generatePlan(refinedTask);
        outputChannel.appendLine('\n🔁 New Plan:');
        newPlan.forEach((step, index) => outputChannel.appendLine(`${index + 1}. ${step}`));

        const newApproval = await vscode.window.showQuickPick(['Yes', 'No'], {
          placeHolder: 'Approve the new plan?'
        });

        if (newApproval !== 'Yes') {
          vscode.window.showInformationMessage('New plan not approved. Exiting.');
          return;
        }

        success = await executeCommands(newPlan, outputChannel);
      }

      vscode.window.showInformationMessage('✅ Task completed successfully!');
    } catch (error) {
      vscode.window.showErrorMessage(`❌ Error: ${error.message}`);
    }
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
