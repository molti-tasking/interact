import {
  SerializedSchema,
  validateNewSchemaWithPreviousSubmissions,
} from "@/lib/schema-manager";
import { cn } from "@/lib/utils";
import z from "zod";
import { Button } from "../ui/button";

export const SchemaSubmissionValidator = ({
  schema,
}: {
  schema: SerializedSchema;
}) => {
  const submissionValidilidy = validateNewSchemaWithPreviousSubmissions(schema);

  return (
    <div>
      <h3 className="text-lg">Submission Validations</h3>
      <div>
        {submissionValidilidy.map((entry, index) => {
          const originalValue = entry.submission.data;

          return (
            <div
              key={`${entry.validation.success}-${index}`}
              className={cn(
                "p-4 rounded-xl my-2 shadow-md",
                entry.validation.success
                  ? "bg-green-200"
                  : "border rounded-2xl border-red-200",
              )}
            >
              {entry.validation.success ? (
                <div>Entry is alright</div>
              ) : (
                <div>
                  <p className={cn("font-bold text-red-900")}>
                    Entry is not valid against the schema
                  </p>
                  <pre>{JSON.stringify(originalValue, null, 2)}</pre>
                  {(() => {
                    const errorProperties = z.treeifyError(
                      entry.validation.error,
                    ).properties;
                    console.log(entry.validation.error);
                    const entries = Object.entries(errorProperties!);
                    return (
                      <div>
                        {entries.map(([key, value]) => (
                          <div key={key}>
                            <span>{key}:</span>
                            {value?.errors.map((error) => (
                              <span key={error} className="italic block">
                                {error}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="p-2 border-2 rounded-2xl mt-4">
                    <p className="mb-2">
                      At this point you could request to adjust this entry
                      according to new schema or alternatively to adjust the
                      schema according to the already existing entry.
                    </p>
                    <div className="flex flex-row gap-2">
                      <Button>Adjust entry</Button>
                      <Button>Adjust schema</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
