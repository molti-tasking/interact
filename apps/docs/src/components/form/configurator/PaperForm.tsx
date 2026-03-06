"use client";

/**
 * This component should provide some sketiching like in-line effects
 */
export const PaperForm = () => {
  return (
    <div className="">
      <form>
        <fieldset
          className="relative m-0 rounded-r-[20px] border-none pt-[30px] pr-[30px] pb-10 pl-20 p-8"
          style={{
            background:
              "#fafafa linear-gradient(rgba(0, 0, 0, 0.1) 1px, transparent 0) 0 20px / 100% 40px",
          }}
        >
          {/* Red margin line */}
          <div className="pointer-events-none absolute top-0 left-[50px] h-full w-px" />

          <p className="m-0 mb-10 leading-10 text-[#333]">Hey, Tester!</p>

          <p className="m-0 mb-10 leading-10 text-[#333]">
            My name is{" "}
            <span
              className={
                "paper-field relative inline leading-10 text-[#7db665] outline-none empty:inline-block empty:text-[#ddd]"
              }
              data-placeholder="your name"
              tabIndex={1}
              contentEditable
              suppressContentEditableWarning
            />{" "}
            and I&apos;m writing to you since I&apos;m interested in{" "}
            <span
              className="paper-field relative inline leading-10 text-[#7db665] outline-none empty:inline-block empty:text-[#ddd]"
              data-placeholder="your message"
              tabIndex={2}
              contentEditable
              suppressContentEditableWarning
            />
            .
          </p>

          <p className="m-0 mb-10 leading-10 text-[#333]">
            This is my{" "}
            <span
              className="paper-field relative inline leading-10 text-[#7db665] outline-none empty:inline-block empty:text-[#ddd]"
              data-placeholder="email address"
              tabIndex={3}
              contentEditable
              suppressContentEditableWarning
            />
            .
          </p>
        </fieldset>
      </form>
    </div>
  );
};
